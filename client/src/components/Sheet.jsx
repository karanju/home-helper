import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useDragControls, useReducedMotion } from 'motion/react';
import { X } from 'lucide-react';
import { useIsMobile } from '../useIsMobile';

// Critically damped: settles without overshoot (Apple's default UI spring)
const SPRING = { type: 'spring', bounce: 0, duration: 0.4 };
const FADE = { duration: 0.2, ease: 'easeOut' };

// Where a flick would come to rest, using scroll-style deceleration (Designing Fluid Interfaces)
function project(velocity, decelerationRate = 0.998) {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

// Each edge enters and leaves along the same path; centered sheets materialize in place
const MOTION = {
  bottom: { hidden: { y: '100%' }, shown: { y: 0 } },
  right: { hidden: { x: '100%' }, shown: { x: 0 } },
  center: { hidden: { opacity: 0, scale: 0.94 }, shown: { opacity: 1, scale: 1 } },
  reduced: { hidden: { opacity: 0 }, shown: { opacity: 1 } }
};

// Sheets can overlap while one animates out, so the page lock is counted, not saved and restored per sheet
let openSheets = 0;

function lockPage() {
  openSheets += 1;
  if (openSheets > 1) return;
  document.body.style.overflow = 'hidden';
  document.getElementById('root')?.setAttribute('inert', '');
}

function unlockPage() {
  openSheets -= 1;
  if (openSheets > 0) return;
  document.body.style.overflow = '';
  document.getElementById('root')?.removeAttribute('inert');
}

function SheetPanel({ onClose, placement, title, eyebrow, footer, children, className }) {
  const titleId = useId();
  const isMobile = useIsMobile();
  const reduceMotion = useReducedMotion();
  const dragControls = useDragControls();
  const panelRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const edge = isMobile ? 'bottom' : placement;
  const axis = edge === 'bottom' ? 'y' : edge === 'right' ? 'x' : null;
  const variants = reduceMotion ? MOTION.reduced : MOTION[edge];

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onCloseRef.current();
    window.addEventListener('keydown', onKey);
    // The page behind stays still and out of the tab order; focus returns to the trigger on close
    const trigger = document.activeElement;
    lockPage();
    // Move focus into the dialog unless a field already took it (autoFocus)
    if (!panelRef.current?.contains(document.activeElement)) panelRef.current?.focus({ preventScroll: true });
    return () => {
      window.removeEventListener('keydown', onKey);
      unlockPage();
      trigger?.focus?.({ preventScroll: true });
    };
  }, []);

  // Drag starts from the header, so the sheet body can still scroll
  const startDrag = (e) => {
    if (!axis || e.button !== 0 || e.target.closest('button')) return;
    dragControls.start(e);
  };

  // Decide from where the gesture is heading, not where it was let go
  const onDragEnd = (_, info) => {
    const size = axis === 'y' ? panelRef.current.offsetHeight : panelRef.current.offsetWidth;
    const projected = info.offset[axis] + project(info.velocity[axis]);
    if (projected > size / 2) onClose();
  };

  return (
    <>
      <motion.div
        className="sheet-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={FADE}
        onClick={onClose}
      />
      <div className={`sheet-layer sheet-layer-${edge}`}>
        <motion.div
          ref={panelRef}
          className={`sheet sheet-${edge} ${className}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          variants={variants}
          initial="hidden"
          animate="shown"
          exit="hidden"
          transition={reduceMotion ? FADE : SPRING}
          drag={axis || false}
          dragListener={false}
          dragControls={dragControls}
          dragConstraints={{ top: 0, bottom: 0, left: 0, right: 0 }}
          // Follows the finger 1:1 toward dismissal, rubber-bands the other way
          dragElastic={axis === 'y' ? { top: 0.06, bottom: 1 } : { left: 0.06, right: 1 }}
          dragTransition={{ bounceStiffness: 400, bounceDamping: 40 }}
          onDragEnd={onDragEnd}
        >
          <div className="sheet-header" onPointerDown={startDrag}>
            {edge === 'bottom' && <div className="sheet-grabber" aria-hidden="true" />}
            <div className="sheet-header-row">
              <div className="sheet-heading">
                {eyebrow && <span className="eyebrow">{eyebrow}</span>}
                <h2 id={titleId} className="title">{title}</h2>
              </div>
              <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
                <X size={18} strokeWidth={2.5} />
              </button>
            </div>
          </div>
          <div className="sheet-body">{children}</div>
          {footer && <div className="sheet-footer">{footer}</div>}
        </motion.div>
      </div>
    </>
  );
}

// Modal sheet: a bottom sheet on phones; on wider screens a side panel (placement="right") or a centered card
export default function Sheet({ open, onClose, placement = 'center', title, eyebrow, footer, className = '', children }) {
  return createPortal(
    <AnimatePresence>
      {open && (
        <SheetPanel
          key="sheet"
          onClose={onClose}
          placement={placement}
          title={title}
          eyebrow={eyebrow}
          footer={footer}
          className={className}
        >
          {children}
        </SheetPanel>
      )}
    </AnimatePresence>,
    document.body
  );
}
