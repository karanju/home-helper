import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, ImagePlus, X } from 'lucide-react';
import { canvasPhoto, shrinkImage } from '../photo';

// Upload and Take photo buttons for the AI chats. The camera opens a live preview where the browser allows it,
// otherwise the phone's camera app through a capture file input.
export default function PhotoPicker({ onPick, disabled, accent, buttonStyle }) {
  const fileRef = useRef(null);
  const captureRef = useRef(null);
  const [cameraOpen, setCameraOpen] = useState(false);

  const pickFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      onPick(await shrinkImage(file));
    } catch (err) {
      alert(err.message);
    }
  };

  const openCamera = () => {
    if (navigator.mediaDevices?.getUserMedia) setCameraOpen(true);
    else captureRef.current?.click();
  };

  const style = { ...styles.button, ...buttonStyle };
  return (
    <>
      <button type="button" onClick={() => fileRef.current?.click()} disabled={disabled} style={style} aria-label="Upload a photo" title="Upload a photo">
        <ImagePlus size={18} />
      </button>
      <button type="button" onClick={openCamera} disabled={disabled} style={style} aria-label="Take a photo" title="Take a photo">
        <Camera size={18} />
      </button>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickFile} />
      <input ref={captureRef} type="file" accept="image/*" capture="environment" hidden onChange={pickFile} />
      {cameraOpen && (
        <CameraModal
          accent={accent}
          onClose={() => setCameraOpen(false)}
          onSnap={(photo) => { setCameraOpen(false); onPick(photo); }}
          onUnavailable={() => { setCameraOpen(false); captureRef.current?.click(); }}
        />
      )}
    </>
  );
}

function CameraModal({ accent, onClose, onSnap, onUnavailable }) {
  const videoRef = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stream = null;
    let cancelled = false;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((s) => {
        if (cancelled) { s.getTracks().forEach(t => t.stop()); return; }
        stream = s;
        videoRef.current.srcObject = s;
      })
      // No camera or permission denied: fall back to the file input, which may still offer the camera app
      .catch(() => !cancelled && onUnavailable());
    return () => {
      cancelled = true;
      stream?.getTracks().forEach(t => t.stop());
    };
  }, []);

  const snap = () => {
    const video = videoRef.current;
    if (!video?.videoWidth) return;
    onSnap(canvasPhoto(video, video.videoWidth, video.videoHeight));
  };

  return createPortal(
    <div style={styles.backdrop} onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Take a photo" style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={onClose} style={styles.close} aria-label="Close camera">
          <X size={20} color="#f8fafc" />
        </button>
        <video ref={videoRef} autoPlay playsInline muted onLoadedData={() => setReady(true)} style={styles.video} />
        <button type="button" onClick={snap} disabled={!ready} style={{ ...styles.snap, backgroundColor: accent }}>
          <Camera size={18} /> {ready ? 'Snap photo' : 'Starting camera...'}
        </button>
      </div>
    </div>,
    document.body
  );
}

const styles = {
  button: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '44px',
    minHeight: '44px',
    flexShrink: 0,
    padding: 0,
    background: 'none',
    border: '1px solid #334155',
    borderRadius: '10px',
    color: '#cbd5e1',
    cursor: 'pointer',
  },
  backdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 10001,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '16px',
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
  },
  modal: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    width: '100%',
    maxWidth: '520px',
    padding: '12px',
    backgroundColor: '#131c2e',
    border: '1px solid #334155',
    borderRadius: '18px',
  },
  close: {
    position: 'absolute',
    top: '18px',
    right: '18px',
    zIndex: 1,
    width: '36px',
    height: '36px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(0, 0, 0, 0.5)',
    border: 'none',
    borderRadius: '9999px',
    cursor: 'pointer',
  },
  video: {
    width: '100%',
    maxHeight: '70dvh',
    borderRadius: '12px',
    backgroundColor: '#000',
    objectFit: 'cover',
  },
  snap: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    minHeight: '48px',
    border: 'none',
    borderRadius: '12px',
    color: '#0b1120',
    fontSize: '15px',
    fontWeight: '700',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
};
