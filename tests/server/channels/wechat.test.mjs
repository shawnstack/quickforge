import { describe, expect, it } from 'vitest'
import { WechatChannelProvider } from '../../../server/channels/providers/wechat.mjs'

describe('WechatChannelProvider', () => {
  it('passes the channel identity and event relay URL to the ACP child process', () => {
    const provider = new WechatChannelProvider({
      projectRoot: process.cwd(),
      channelEventsUrl: 'http://127.0.0.1:32176/api/channels/events',
    })
    const command = provider.buildStartCommand()

    expect(command.env.QUICKFORGE_ACP_CHANNEL_ID).toBe('wechat')
    expect(command.env.QUICKFORGE_ACP_CHANNEL_NAME).toBe('微信')
    expect(command.env.QUICKFORGE_CHANNEL_EVENTS_URL).toBe('http://127.0.0.1:32176/api/channels/events')
  })
})
