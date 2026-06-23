'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Check, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { FilterDefinition } from '../../../domain/filter-types';

type AsyncSelectInputProps = {
  filter: FilterDefinition;
  value: string | string[];
  onChange: (value: string) => void;
};

export const AsyncSelectInput = ({
  filter,
  value,
  onChange,
}: AsyncSelectInputProps) => {
  const t = useTranslations('common');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Debounce search input by 800ms
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 800);
    return () => clearTimeout(timer);
  }, [search]);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery({
    queryKey: ['async-filter', filter.id, debouncedSearch],
    queryFn: async ({ pageParam = 0 }) => {
      if (!filter.fetcher) return { options: [], hasMore: false };
      return filter.fetcher({ search: debouncedSearch, page: pageParam });
    },
    getNextPageParam: (lastPage, allPages) =>
      lastPage.hasMore ? allPages.length : undefined,
    initialPageParam: 0,
  });

  // IntersectionObserver for infinite scroll
  const observerCallback = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
        fetchNextPage();
      }
    },
    [hasNextPage, isFetchingNextPage, fetchNextPage],
  );

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(observerCallback, {
      threshold: 0.1,
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [observerCallback]);

  const allOptions = data?.pages.flatMap((page) => page.options) ?? [];
  const selectedValue = Array.isArray(value) ? value[0] : value;

  return (
    <div className="space-y-2">
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={filter.placeholder || t('typeToFilter')}
        className="h-8 text-sm"
        autoFocus
      />
      <div className="-mx-1 max-h-48 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : allOptions.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-3">
            {t('noResults')}
          </p>
        ) : (
          <>
            {allOptions.map((option) => {
              const isSelected = selectedValue === option.value;
              return (
                <button
                  key={option.value}
                  className={cn(
                    'flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm outline-none cursor-pointer',
                    isSelected
                      ? 'bg-accent text-accent-foreground'
                      : 'hover:bg-accent/50',
                  )}
                  onClick={() => onChange(option.value)}
                >
                  <span>{option.label}</span>
                  {isSelected && <Check className="h-3.5 w-3.5 text-foreground" />}
                </button>
              );
            })}
            <div ref={sentinelRef} className="h-1" />
            {isFetchingNextPage && (
              <div className="flex items-center justify-center py-2">
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
