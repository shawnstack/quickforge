package com.quickforge.mobile.remote

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * 云账户凭据持久化：
 * - refreshToken 用 Android Keystore 的 AES/GCM 密钥加密后存 SharedPreferences（每次随机 IV）；
 * - cloudUrl、email（账号邮箱，非敏感）明文存 SharedPreferences；
 * - accessToken 仅存内存（见 [SessionStore]），落盘路径不含 access token。
 */
class CloudAccountStore(context: Context) {

    private val appContext = context.applicationContext
    private val prefs = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    private val keyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }

    /** 保存（或轮换）refreshToken、cloudUrl 与账号邮箱；email 可空（明文存储，与 cloudUrl 同级）。 */
    fun save(refreshToken: String, cloudUrl: String, email: String? = null) {
        val key = getOrCreateKey()
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key)
        val iv = cipher.iv
        val ciphertext = cipher.doFinal(refreshToken.toByteArray(Charsets.UTF_8))
        prefs.edit()
            .putString(PREF_REFRESH_IV, Base64.encodeToString(iv, Base64.NO_WRAP))
            .putString(PREF_REFRESH_CT, Base64.encodeToString(ciphertext, Base64.NO_WRAP))
            .putString(PREF_CLOUD_URL, cloudUrl)
            .putString(PREF_EMAIL, email)
            .apply()
    }

    /** 解密读取 refreshToken；密钥失效（指纹变更等）视为未登录，返回 null。 */
    fun refreshToken(): String? {
        val ivB64 = prefs.getString(PREF_REFRESH_IV, null) ?: return null
        val ctB64 = prefs.getString(PREF_REFRESH_CT, null) ?: return null
        return try {
            val key = keyStore.getKey(KEY_ALIAS, null) as? SecretKey ?: return null
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(
                Cipher.DECRYPT_MODE,
                key,
                GCMParameterSpec(GCM_TAG_BITS, Base64.decode(ivB64, Base64.NO_WRAP))
            )
            String(cipher.doFinal(Base64.decode(ctB64, Base64.NO_WRAP)), Charsets.UTF_8)
        } catch (_: Exception) {
            null
        }
    }

    fun cloudUrl(): String? = prefs.getString(PREF_CLOUD_URL, null)

    /** 读取账号邮箱；未保存（旧会话）时返回 null。 */
    fun email(): String? = prefs.getString(PREF_EMAIL, null)

    fun clear() {
        prefs.edit()
            .remove(PREF_REFRESH_IV)
            .remove(PREF_REFRESH_CT)
            .remove(PREF_CLOUD_URL)
            .remove(PREF_EMAIL)
            .apply()
    }

    private fun getOrCreateKey(): SecretKey {
        keyStore.getKey(KEY_ALIAS, null)?.let { return it as SecretKey }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        )
        return generator.generateKey()
    }

    companion object {
        private const val KEYSTORE = "AndroidKeyStore"
        private const val KEY_ALIAS = "qf_cloud_refresh"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val GCM_TAG_BITS = 128
        private const val PREFS_NAME = "qf_cloud_account"
        private const val PREF_REFRESH_IV = "refresh_iv"
        private const val PREF_REFRESH_CT = "refresh_ct"
        private const val PREF_CLOUD_URL = "cloud_url"
        private const val PREF_EMAIL = "email"
    }
}

/** accessToken 仅存内存（进程级），App 重启后由 refreshToken 换新。 */
object SessionStore {
    @Volatile
    var accessToken: String? = null
}
