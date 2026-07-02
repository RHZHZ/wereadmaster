import { startTransition, useEffect, useState } from "react";
import {
  getCommandErrorInfo,
  getReadingStats,
  syncReadingStats,
  type CommandErrorInfo,
  type ReadingStatsResponse
} from "../../../lib/reading-api";
import type { CredentialStatus, ReadingStatsMode } from "../../../lib/types";
import {
  buildReadingStatsPeriod,
  canShiftReadingStatsPeriod,
  getReadingStatsRequestBaseTime,
  getReadingStatsResponse,
  shiftReadingStatsPeriod,
  type ReadingStatsCache,
  type ReadingStatsPeriod
} from "../../../pages/reading-stats-period";
import {
  buildReadingStatsDrillPeriods,
  hasReadingStatsData
} from "../reading-stats-view-helpers";

type UseReadingStatsPageArgs = {
  credentialStatus?: CredentialStatus;
  cache: ReadingStatsCache;
  defaultMode: ReadingStatsMode;
  onCacheChange: (mode: ReadingStatsMode, response: ReadingStatsResponse) => void;
  onOpenSettings: () => void;
};

export function useReadingStatsPage({
  credentialStatus,
  cache,
  defaultMode,
  onCacheChange,
  onOpenSettings
}: UseReadingStatsPageArgs) {
  const [period, setPeriod] = useState<ReadingStatsPeriod>(() => buildReadingStatsPeriod(defaultMode));
  const [isLoadingCache, setIsLoadingCache] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<CommandErrorInfo>();
  const hasCredential = credentialStatus?.hasCredential === true;
  const response = getReadingStatsResponse(cache, period);
  const stats = response?.stats;
  const activePeriod = stats ? buildReadingStatsPeriod(stats.mode, stats.baseTime) : period;
  const isOverallMode = activePeriod.mode === "overall";
  const canStepForward = canShiftReadingStatsPeriod(activePeriod, 1);
  const drillPeriods = buildReadingStatsDrillPeriods(stats);
  const hasStatsData = hasReadingStatsData(stats);

  useEffect(() => {
    let isMounted = true;

    async function loadCachedStats() {
      if (response) {
        setError(undefined);
        setIsLoadingCache(false);
        return;
      }

      setIsLoadingCache(true);
      setError(undefined);

      try {
        const cached = await getReadingStats(period.mode, getReadingStatsRequestBaseTime(period));
        if (isMounted) {
          onCacheChange(period.mode, cached);
        }
      } catch (loadError) {
        if (isMounted) {
          setError(getCommandErrorInfo(loadError));
        }
      } finally {
        if (isMounted) {
          setIsLoadingCache(false);
        }
      }
    }

    void loadCachedStats();

    return () => {
      isMounted = false;
    };
  }, [onCacheChange, period, response]);

  async function handleSync() {
    if (!hasCredential) {
      setError({ message: "请先在设置中保存微信读书 API Key，再同步阅读统计。" });
      onOpenSettings();
      return;
    }

    setIsSyncing(true);
    setError(undefined);

    try {
      const synced = await syncReadingStats(period.mode, getReadingStatsRequestBaseTime(period));
      onCacheChange(period.mode, synced);
    } catch (syncError) {
      setError(getCommandErrorInfo(syncError));
    } finally {
      setIsSyncing(false);
    }
  }

  function handleModeChange(nextMode: ReadingStatsMode) {
    startTransition(() => {
      setPeriod(buildReadingStatsPeriod(nextMode));
    });
  }

  function handleShiftPeriod(offset: -1 | 1) {
    startTransition(() => {
      setPeriod(shiftReadingStatsPeriod(activePeriod, offset));
    });
  }

  function handleDrillPeriod(nextPeriod: ReadingStatsPeriod) {
    startTransition(() => {
      setPeriod(nextPeriod);
    });
  }

  return {
    activePeriod,
    canStepForward,
    drillPeriods,
    error,
    handleDrillPeriod,
    handleModeChange,
    handleShiftPeriod,
    handleSync,
    hasCredential,
    hasStatsData,
    isLoadingCache,
    isOverallMode,
    isSyncing,
    period,
    response,
    stats
  };
}
