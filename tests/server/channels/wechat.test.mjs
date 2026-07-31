import { describe, expect, it } from 'vitest'
import { WechatChannelProvider } from '../../../server/channels/providers/wechat.mjs'

describe('WechatChannelProvider', () => {
  it('passes the channel identity to the ACP child process', () => {
    const provider = new WechatChannelProvider({ projectRoot: process.cwd() })
    const command = provider.buildStartCommand()

    expect(command.env.QUICKFORGE_ACP_CHANNEL_ID).toBe('wechat')
    expect(command.env.QUICKFORGE_ACP_CHANNEL_NAME).toBe('微信')
  })
})
