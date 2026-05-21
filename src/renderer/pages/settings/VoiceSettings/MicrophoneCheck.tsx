/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@arco-design/web-react';
import { Mic, MicOff, Square } from 'lucide-react';
import WaylandSelect from '@/renderer/components/base/WaylandSelect';

type CheckState = 'idle' | 'requesting' | 'live' | 'error';
type Quality = 'silent' | 'quiet' | 'active' | 'loud' | 'clipping';

const SILENT_PCT = 1; // peak < 1% => "silent"
const QUIET_PCT = 8; // peak < 8% => "quiet"
const LOUD_PCT = 85; // peak >= 85% => "loud"
const CLIPPING_PCT = 95; // peak >= 95% for 3 frames => "clipping"
const PEAK_DECAY_PER_FRAME = 0.5; // peak indicator drops 0.5% per ~16ms

const DEFAULT_DEVICE_ID = '';

const MicrophoneCheck: React.FC = () => {
  const { t } = useTranslation();
  const [state, setState] = useState<CheckState>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [level, setLevel] = useState(0);
  const [peak, setPeak] = useState(0);
  const [rms, setRms] = useState(0);
  const [quality, setQuality] = useState<Quality>('silent');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>(DEFAULT_DEVICE_ID);

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const peakRef = useRef(0);
  const clipFramesRef = useRef(0);

  const refreshDevices = useCallback(async (): Promise<void> => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(list.filter((d) => d.kind === 'audioinput'));
    } catch {
      // best-effort
    }
  }, []);

  useEffect(() => {
    void refreshDevices();
    if (!navigator.mediaDevices?.addEventListener) return;
    const handler = (): void => {
      void refreshDevices();
    };
    navigator.mediaDevices.addEventListener('devicechange', handler);
    return (): void => {
      navigator.mediaDevices.removeEventListener('devicechange', handler);
    };
  }, [refreshDevices]);

  const cleanup = useCallback((): void => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    peakRef.current = 0;
    clipFramesRef.current = 0;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const handleStop = useCallback((): void => {
    cleanup();
    setState('idle');
    setLevel(0);
    setPeak(0);
    setRms(0);
    setQuality('silent');
  }, [cleanup]);

  const handleStart = useCallback(async (): Promise<void> => {
    setState('requesting');
    setErrorMsg('');
    setLevel(0);
    setPeak(0);
    setRms(0);
    setQuality('silent');
    peakRef.current = 0;
    clipFramesRef.current = 0;

    const constraints: MediaStreamConstraints = {
      audio: selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : true,
    };

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      cleanup();
      setState('error');
      const name = err instanceof Error ? err.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setErrorMsg(
          t(
            'settings.voiceMicPermissionBlocked',
            'Microphone access blocked. Open System Settings → Privacy → Microphone and enable Wayland.'
          )
        );
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        setErrorMsg(
          t('settings.voiceMicNotFound', 'Selected microphone is not available. Pick another input device.')
        );
      } else {
        setErrorMsg(err instanceof Error ? err.message : String(err));
      }
      return;
    }

    streamRef.current = stream;
    const ContextClass: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new ContextClass();
    audioCtxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.7;
    source.connect(analyser);
    analyserRef.current = analyser;

    void refreshDevices();

    setState('live');

    // Use time-domain data for RMS + peak instead of frequency-domain so
    // the meter reflects actual amplitude, not spectral energy.
    const timeBuffer = new Uint8Array(analyser.fftSize);

    const tick = (): void => {
      if (!analyserRef.current) return;
      analyserRef.current.getByteTimeDomainData(timeBuffer);

      // Sample is 0..255, centered at 128. Peak = max abs deviation.
      let instantaneousPeak = 0;
      let sumSquares = 0;
      for (let i = 0; i < timeBuffer.length; i++) {
        const deviation = Math.abs(timeBuffer[i] - 128);
        if (deviation > instantaneousPeak) instantaneousPeak = deviation;
        sumSquares += deviation * deviation;
      }
      const peakPct = Math.round((instantaneousPeak / 128) * 100);
      const rmsPct = Math.round((Math.sqrt(sumSquares / timeBuffer.length) / 128) * 100);

      setLevel(peakPct);
      setRms(rmsPct);

      // Held peak with decay — gives a peak-hold ribbon above the live bar.
      const decayed = Math.max(0, peakRef.current - PEAK_DECAY_PER_FRAME);
      peakRef.current = Math.max(decayed, peakPct);
      setPeak(Math.round(peakRef.current));

      // Clipping requires sustained presence — 3 consecutive frames over threshold.
      if (peakPct >= CLIPPING_PCT) {
        clipFramesRef.current += 1;
      } else {
        clipFramesRef.current = 0;
      }

      let nextQuality: Quality;
      if (clipFramesRef.current >= 3) {
        nextQuality = 'clipping';
      } else if (peakPct < SILENT_PCT) {
        nextQuality = 'silent';
      } else if (peakPct < QUIET_PCT) {
        nextQuality = 'quiet';
      } else if (peakPct >= LOUD_PCT) {
        nextQuality = 'loud';
      } else {
        nextQuality = 'active';
      }
      setQuality(nextQuality);

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [cleanup, refreshDevices, selectedDeviceId, t]);

  const isLive = state === 'live';
  const isRequesting = state === 'requesting';

  const deviceOptionLabel = (d: MediaDeviceInfo, index: number): string => {
    if (d.label) return d.label;
    return t('settings.voiceMicDeviceFallback', { defaultValue: 'Microphone {{n}}', n: index + 1 });
  };

  const qualityLabel: Record<Quality, string> = {
    silent: t('settings.voiceMicQualitySilent', 'No signal detected'),
    quiet: t('settings.voiceMicQualityQuiet', 'Quiet — speak louder or move closer'),
    active: t('settings.voiceMicQualityActive', 'Picking up clearly'),
    loud: t('settings.voiceMicQualityLoud', 'Strong signal'),
    clipping: t('settings.voiceMicQualityClipping', 'Clipping — back off or reduce input gain'),
  };

  const qualityDot: Record<Quality, string> = {
    silent: 'bg-[var(--color-text-4)]',
    quiet: 'bg-[rgb(var(--warning-6))]',
    active: 'bg-[rgb(var(--success-6))]',
    loud: 'bg-[rgb(var(--success-6))]',
    clipping: 'bg-[rgb(var(--danger-6))]',
  };

  return (
    <div className='flex flex-col gap-12px rounded-12px border border-solid border-[var(--color-border-2)] bg-[var(--color-bg-2)] p-12px'>
      <div className='flex items-center gap-12px flex-wrap'>
        <WaylandSelect
          size='small'
          value={selectedDeviceId}
          onChange={(value: string) => setSelectedDeviceId(value)}
          disabled={isLive || isRequesting}
          style={{ minWidth: 240 }}
        >
          <WaylandSelect.Option value={DEFAULT_DEVICE_ID}>
            {t('settings.voiceMicDeviceDefault', 'System default microphone')}
          </WaylandSelect.Option>
          {devices.map((device, index) => (
            <WaylandSelect.Option key={device.deviceId} value={device.deviceId}>
              {deviceOptionLabel(device, index)}
            </WaylandSelect.Option>
          ))}
        </WaylandSelect>
        {isLive ? (
          <Button
            type='outline'
            size='small'
            status='danger'
            icon={<Square size={12} />}
            onClick={handleStop}
          >
            {t('settings.voiceMicStop', 'Stop')}
          </Button>
        ) : (
          <Button
            type='outline'
            size='small'
            icon={<Mic size={14} />}
            loading={isRequesting}
            disabled={isRequesting}
            onClick={() => void handleStart()}
          >
            {isRequesting
              ? t('settings.voiceMicRequesting', 'Requesting access…')
              : t('settings.voiceMicStart', 'Start live meter')}
          </Button>
        )}
      </div>

      {/* Live meter — peak bar with held-peak ribbon + RMS ghost */}
      <div className='flex flex-col gap-6px'>
        <div className='relative h-10px rd-full bg-[var(--color-fill-2)] overflow-hidden'>
          {/* RMS (average loudness) — subtle ghost behind the peak */}
          <div
            className='absolute inset-y-0 left-0 bg-[rgba(255,107,53,0.25)] transition-[width] duration-75'
            style={{ width: `${rms}%` }}
          />
          {/* Instantaneous peak — primary bar */}
          <div
            className={`absolute inset-y-0 left-0 transition-[width] duration-75 ${
              quality === 'clipping' ? 'bg-[rgb(var(--danger-6))]' : 'bg-[rgb(var(--primary-6))]'
            }`}
            style={{ width: `${level}%` }}
          />
          {/* Held peak — 2px vertical line that decays */}
          {peak > 0 && isLive && (
            <div
              className='absolute inset-y-0 w-2px bg-[var(--color-text-1)] transition-[left] duration-75'
              style={{ left: `calc(${Math.min(peak, 100)}% - 1px)` }}
            />
          )}
        </div>

        {/* Quality + numeric readouts */}
        <div className='flex items-center justify-between text-12px'>
          <div className='flex items-center gap-6px text-t-secondary'>
            <span
              className={`inline-block w-8px h-8px rd-full ${
                isLive ? qualityDot[quality] : 'bg-[var(--color-text-4)]'
              }`}
            />
            <span>
              {isLive
                ? qualityLabel[quality]
                : state === 'error'
                  ? errorMsg
                  : t('settings.voiceMicIdleHint', 'Pick a device and start the live meter to verify input.')}
            </span>
          </div>
          {isLive && (
            <div className='flex items-center gap-12px text-t-tertiary tabular-nums'>
              <span>
                {t('settings.voiceMicLevelLabel', 'peak')} {level}%
              </span>
              <span>
                {t('settings.voiceMicRmsLabel', 'avg')} {rms}%
              </span>
              <span>
                {t('settings.voiceMicHeldLabel', 'held')} {peak}%
              </span>
            </div>
          )}
        </div>
      </div>

      {state === 'error' && !errorMsg && (
        <span className='text-12px text-[rgb(var(--danger-6))] flex items-center gap-6px'>
          <MicOff size={12} /> {t('settings.voiceMicError', 'Microphone error')}
        </span>
      )}
    </div>
  );
};

export default MicrophoneCheck;
