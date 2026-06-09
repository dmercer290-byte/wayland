/**
 * Unit tests for the channel auto-approve (yoloMode) source check.
 *
 * Channels have no interactive human to confirm tool-permission prompts, so
 * every channel source must auto-approve. Non-channel sources ('wayland' = in-app,
 * 'user' = workflow) must NOT, so they keep interactive approval.
 */
import { describe, it, expect } from 'vitest';
import { isAutoApproveChannelSource, CHANNEL_AUTO_APPROVE_SOURCES } from '@/process/channels/types';

describe('isAutoApproveChannelSource', () => {
  it('returns true for every registered channel source', () => {
    for (const source of [
      'telegram',
      'slack',
      'discord',
      'whatsapp',
      'email-imap',
      'signal',
      'sms-twilio',
      'google-chat',
      'line',
      'imessage',
      'lark',
      'dingtalk',
      'weixin',
      'wecom',
    ]) {
      expect(isAutoApproveChannelSource(source)).toBe(true);
    }
  });

  it('returns false for non-channel and empty sources', () => {
    for (const source of ['wayland', 'user', '', null, undefined]) {
      expect(isAutoApproveChannelSource(source)).toBe(false);
    }
  });

  it('regression: slack and discord are included (the original hang bug)', () => {
    expect(CHANNEL_AUTO_APPROVE_SOURCES.has('slack')).toBe(true);
    expect(CHANNEL_AUTO_APPROVE_SOURCES.has('discord')).toBe(true);
  });
});
