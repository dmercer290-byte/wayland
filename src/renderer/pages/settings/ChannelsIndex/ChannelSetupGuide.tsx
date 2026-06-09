/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Collapse, Typography } from '@arco-design/web-react';
import { Down, LinkOne } from '@icon-park/react';
import { openExternalUrl } from '@/renderer/utils/platform';
import { getChannelSetupGuide } from './channelSetupGuides';
import styles from './ChannelSetupGuide.module.css';

type ChannelSetupGuideProps = {
  /** Same channel id passed to ChannelDetailLayout (e.g. 'slack', 'email-imap'). */
  channelId: string;
};

/**
 * Collapsed-by-default "How to set up" accordion shown on each channel's Setup
 * page. Expands to a numbered, ordered list of steps with clickable external
 * links (developer consoles, token pages) that open in the user's browser via
 * the shared external-link bridge. Renders nothing when the channel has no
 * guide content.
 */
const ChannelSetupGuide: React.FC<ChannelSetupGuideProps> = ({ channelId }) => {
  const { t } = useTranslation();
  const guide = getChannelSetupGuide(channelId);

  if (!guide) return null;

  return (
    <Collapse className={styles.guide} bordered={false} expandIcon={<Down theme='outline' size={16} />}>
      <Collapse.Item
        name='how-to-set-up'
        header={
          <Typography.Text className='text-13px font-medium text-[var(--text-primary)]'>
            {t(guide.titleKey, guide.titleDefault)}
          </Typography.Text>
        }
      >
        <ol className='m-0 pl-20px flex flex-col gap-10px'>
          {guide.steps.map((step) => (
            <li key={step.textKey} className='text-13px text-[var(--text-secondary)] leading-relaxed'>
              <span>{t(step.textKey, step.textDefault)}</span>
              {step.links && step.links.length > 0 && (
                <div className='mt-6px flex flex-col gap-4px'>
                  {step.links.map((link) => (
                    <Typography.Text
                      key={link.url}
                      className='inline-flex items-center gap-4px text-13px text-[var(--brand)] cursor-pointer w-fit'
                      onClick={() => {
                        void openExternalUrl(link.url);
                      }}
                    >
                      <LinkOne theme='outline' size={13} />
                      {t(link.labelKey, link.labelDefault)}
                    </Typography.Text>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ol>
      </Collapse.Item>
    </Collapse>
  );
};

export default ChannelSetupGuide;
