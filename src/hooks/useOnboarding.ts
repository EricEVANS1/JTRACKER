import { useCallback, useEffect, useMemo, useState } from 'react';

import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

interface CompletedSteps {
  hasApplication: boolean;
  hasCV: boolean;
  hasRecruiter: boolean;
  hasFollowUp: boolean;
}

interface UseOnboardingReturn {
  loading: boolean;
  onboardingComplete: boolean;
  completedSteps: CompletedSteps;
  completedCount: number;
  totalSteps: number;
  progressPercent: number;
  refreshOnboarding: () => Promise<void>;
  dismissOnboarding: () => Promise<void>;
}

export const useOnboarding = (): UseOnboardingReturn => {
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [profileComplete, setProfileComplete] = useState(false);
  const [completedSteps, setCompletedSteps] = useState<CompletedSteps>({
    hasApplication: false,
    hasCV: false,
    hasRecruiter: false,
    hasFollowUp: false,
  });

  const completedCount = useMemo(() => {
    return [
      completedSteps.hasApplication,
      completedSteps.hasCV,
      completedSteps.hasRecruiter || completedSteps.hasFollowUp,
    ].filter(Boolean).length;
  }, [completedSteps]);

  const totalSteps = 3;

  const progressPercent = Math.round((completedCount / totalSteps) * 100);

  const onboardingComplete = useMemo(() => {
    return profileComplete || completedSteps.hasApplication;
  }, [profileComplete, completedSteps.hasApplication]);

  const markCompleteInProfile = useCallback(async () => {
    if (!user) return;

    await supabase
      .from('profiles')
      .update({ onboarding_complete: true })
      .eq('id', user.id);

    setProfileComplete(true);
  }, [user]);

  const refreshOnboarding = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    setLoading(true);

    const [
      profileResult,
      applicationsResult,
      cvResult,
      recruitersResult,
      followUpsResult,
    ] = await Promise.all([
      supabase
        .from('profiles')
        .select('onboarding_complete')
        .eq('id', user.id)
        .maybeSingle(),

      supabase
        .from('applications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id),

      supabase
        .from('cv_versions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id),

      supabase
        .from('recruiters')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id),

      supabase
        .from('applications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .not('follow_up_date', 'is', null),
    ]);

    const nextSteps: CompletedSteps = {
      hasApplication: (applicationsResult.count || 0) > 0,
      hasCV: (cvResult.count || 0) > 0,
      hasRecruiter: (recruitersResult.count || 0) > 0,
      hasFollowUp: (followUpsResult.count || 0) > 0,
    };

    const profileAlreadyComplete =
      profileResult.data?.onboarding_complete === true;

    setCompletedSteps(nextSteps);
    setProfileComplete(profileAlreadyComplete);

    if (!profileAlreadyComplete && nextSteps.hasApplication) {
      await markCompleteInProfile();
    }

    setLoading(false);
  }, [user, markCompleteInProfile]);

  const dismissOnboarding = useCallback(async () => {
    await markCompleteInProfile();
  }, [markCompleteInProfile]);

  useEffect(() => {
    refreshOnboarding();
  }, [refreshOnboarding]);

  return {
    loading,
    onboardingComplete,
    completedSteps,
    completedCount,
    totalSteps,
    progressPercent,
    refreshOnboarding,
    dismissOnboarding,
  };
};