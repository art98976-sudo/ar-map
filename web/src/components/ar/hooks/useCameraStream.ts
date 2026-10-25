import { useEffect, useRef, useState } from 'react';

/**
 * Shows the back camera in the returned video ref while `active`. `on` says whether the picture is
 * showing; when the camera cannot start, `onError` gets a message saying why (AR then shows a simulated view).
 */
export function useCameraStream(active: boolean, onError: (message: string) => void) {
  const video = useRef<HTMLVideoElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!active) return;
    let stream: MediaStream | null = null;
    let cancelled = false;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('no camera'), { name: 'NotSupportedError' });
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        const v = video.current!;
        v.srcObject = stream;
        await v.play().catch(() => {});
        setOn(true);
      } catch (e) {
        const name = (e as Error)?.name;
        onError(
          name === 'NotAllowedError'
            ? 'Camera access is blocked. Allow the camera for this site in your browser settings. Showing a simulated view.'
            : !window.isSecureContext
              ? 'The camera needs a secure (https) link. Showing a simulated view.'
              : 'No camera available. Showing a simulated view.',
        );
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      setOn(false);
    };
  }, [active, onError]);
  return { videoRef: video, on };
}
