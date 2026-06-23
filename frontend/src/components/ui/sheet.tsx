'use client';

import * as React from 'react';
import * as SheetPrimitive from '@radix-ui/react-dialog';
import { XIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetPortal({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50',
        className,
      )}
      {...props}
    />
  );
}

const SWIPE_THRESHOLD = 100;

function SheetContent({
  className,
  children,
  side = 'right',
  showCloseButton = true,
  overlayClassName,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: 'top' | 'right' | 'bottom' | 'left';
  showCloseButton?: boolean;
  overlayClassName?: string;
}) {
  const contentRef = React.useRef<HTMLDivElement>(null);
  const touchStartRef = React.useRef<{ x: number; y: number } | null>(null);
  const [swipeOffset, setSwipeOffset] = React.useState(0);
  const [isSwiping, setIsSwiping] = React.useState(false);

  const isHorizontal = side === 'left' || side === 'right';

  const handleTouchStart = React.useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      const touch = e.touches[0];
      touchStartRef.current = { x: touch.clientX, y: touch.clientY };
      setIsSwiping(false);
    },
    [],
  );

  const handleTouchMove = React.useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (!touchStartRef.current) return;

      const touch = e.touches[0];
      const deltaX = touch.clientX - touchStartRef.current.x;
      const deltaY = touch.clientY - touchStartRef.current.y;

      // Only handle horizontal swipes for side sheets
      if (!isHorizontal) return;

      // Determine if this is a horizontal swipe (not vertical scroll)
      if (!isSwiping) {
        const isHorizontalSwipe =
          Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10;
        if (isHorizontalSwipe) {
          setIsSwiping(true);
        } else if (Math.abs(deltaY) > 10) {
          // This is a vertical scroll, don't interfere
          touchStartRef.current = null;
          return;
        }
      }

      if (isSwiping) {
        // For right sheet: positive delta (swipe right) dismisses
        // For left sheet: negative delta (swipe left) dismisses
        const dismissDirection = side === 'right' ? 1 : -1;
        const offset = deltaX * dismissDirection;

        // Only allow swipe in dismiss direction (positive offset)
        if (offset > 0) {
          setSwipeOffset(offset);
        }
      }
    },
    [isHorizontal, isSwiping, side],
  );

  const handleTouchEnd = React.useCallback(() => {
    if (swipeOffset > SWIPE_THRESHOLD) {
      // Close the sheet by clicking the close button programmatically
      const closeButton = contentRef.current?.querySelector(
        '[data-slot="sheet-close-button"]',
      );
      if (closeButton instanceof HTMLElement) {
        closeButton.click();
      }
    }

    // Reset state
    touchStartRef.current = null;
    setSwipeOffset(0);
    setIsSwiping(false);
  }, [swipeOffset]);

  // Calculate transform based on swipe offset
  const getSwipeTransform = () => {
    if (swipeOffset === 0) return undefined;

    if (side === 'right') {
      return `translateX(${swipeOffset}px)`;
    }
    if (side === 'left') {
      return `translateX(-${swipeOffset}px)`;
    }

    return undefined;
  };

  const swipeStyle: React.CSSProperties = {
    transform: getSwipeTransform(),
    transition: isSwiping ? 'none' : undefined,
  };

  return (
    <SheetPortal>
      <SheetOverlay className={overlayClassName} />
      <SheetPrimitive.Content
        ref={contentRef}
        data-slot="sheet-content"
        className={cn(
          'bg-background data-[state=open]:animate-in data-[state=closed]:animate-out fixed z-50 flex flex-col shadow-lg transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500',
          side === 'right' &&
            'data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right inset-y-0 right-0 h-full w-full border-l sm:w-3/4 sm:max-w-sm',
          side === 'left' &&
            'data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left inset-y-0 left-0 h-full w-full border-r sm:w-3/4 sm:max-w-sm',
          side === 'top' &&
            'data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top inset-x-0 top-0 h-auto border-b',
          side === 'bottom' &&
            'data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom inset-x-0 bottom-0 h-auto border-t',
          isHorizontal && 'touch-pan-y',
          className,
        )}
        style={swipeStyle}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        {...props}
      >
        {children}
        {showCloseButton ? (
          <SheetPrimitive.Close
            data-slot="sheet-close-button"
            className="data-[state=open]:bg-secondary absolute top-3 right-4 flex min-h-11 min-w-11 items-center justify-center rounded-sm opacity-70 transition-all hover:opacity-100 hover:text-destructive hover:scale-110 focus:outline-hidden disabled:pointer-events-none"
          >
            <XIcon className="size-4" />
            <span className="sr-only">Close</span>
          </SheetPrimitive.Close>
        ) : (
          <SheetPrimitive.Close
            data-slot="sheet-close-button"
            className="sr-only"
            tabIndex={-1}
          >
            <span className="sr-only">Close</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-header"
      className={cn('flex flex-col gap-1.5 pt-8 px-4 pb-4', className)}
      {...props}
    />
  );
}

function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn('mt-auto flex flex-col gap-2 p-4', className)}
      {...props}
    />
  );
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn('text-foreground font-semibold', className)}
      {...props}
    />
  );
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn('text-muted-foreground text-sm', className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
};
