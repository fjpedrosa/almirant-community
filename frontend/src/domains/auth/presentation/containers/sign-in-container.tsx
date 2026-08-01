'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type {
  AuthPageMode,
  EnabledAuthProviders,
  SocialAuthProvider,
} from '../../domain/types';
import { useAuth } from '../../application/hooks/use-auth';
import { resolveSafeAuthRedirectTarget } from '../../application/lib/auth-route-state';
import {
  notifyPublicSignupPageOpened,
  submitSignupWithLifecycle,
} from '../../application/lib/signup-lifecycle';
import {
  storeSignupAttribution,
  type SignupAttribution,
} from '../../application/lib/signup-attribution';
import { shouldTrackCloudSignupFunnel } from '../../application/lib/signup-analytics';
import { SignInCard } from '../components/sign-in-card';
import { isCloudDeployment } from '@/lib/deployment-mode';

const SignInContent = ({
  mode,
  socialProviders,
  signupAttribution,
  showSignUpLink,
  signUpHref,
  showInvitationHint,
  isPublicSignUp = false,
}: {
  mode: AuthPageMode;
  socialProviders?: EnabledAuthProviders;
  signupAttribution?: SignupAttribution;
  showSignUpLink?: boolean;
  signUpHref?: string;
  showInvitationHint?: boolean;
  isPublicSignUp?: boolean;
}) => {
  const {
    signInWithEmail,
    signUpWithEmail,
    signInWithGoogle,
    signInWithGithub,
    isLoading,
  } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [credentials, setCredentials] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const searchParams = useSearchParams();
  const t = useTranslations('auth.errors');
  const errorParam = searchParams.get('error');
  const redirectTo = searchParams.get('redirectTo');
  const hasNotifiedPublicSignup = useRef(false);

  const ERROR_KEYS: Record<string, string> = {
    unauthorized: 'unauthorized',
  };

  const errorMessage = localError
    ? localError
    : errorParam
    ? t(ERROR_KEYS[errorParam] ?? 'generic')
    : null;

  const isSignUpMode = mode === 'initial_admin_setup' || mode === 'sign_up';
  const isPublicSignup = mode === 'sign_up' && isPublicSignUp;
  // Stricter gate for the attribution *payload* only (adds the deployment-mode
  // check main's `isPublicSignup` above doesn't have): a self-hosted install
  // that happens to allow public registration still opens the lifecycle seam
  // (`isPublicSignup`), but must not tag events with Cloud marketing
  // attribution. Does not affect whether the seam fires, so it can't change
  // when `notifyPublicSignupPageOpened`/`submitSignupWithLifecycle` are called.
  const isCloudSignupFunnel = shouldTrackCloudSignupFunnel(
    isCloudDeployment(),
    mode,
    Boolean(isPublicSignUp)
  );
  const redirectTarget =
    mode === 'initial_admin_setup'
      ? '/onboarding'
      : resolveSafeAuthRedirectTarget(redirectTo);

  useEffect(() => {
    if (!isPublicSignup || hasNotifiedPublicSignup.current) {
      return;
    }

    hasNotifiedPublicSignup.current = true;
    const attribution = isCloudSignupFunnel ? signupAttribution : undefined;
    if (attribution) {
      notifyPublicSignupPageOpened(attribution);
    } else {
      notifyPublicSignupPageOpened();
    }
  }, [isPublicSignup, isCloudSignupFunnel, signupAttribution]);

  const validationError = useMemo(() => {
    if (!isSignUpMode) {
      return null;
    }

    if (!credentials.name.trim()) {
      return t('nameRequired');
    }

    if (credentials.password.length < 8) {
      return t('passwordTooShort');
    }

    if (credentials.password !== credentials.confirmPassword) {
      return t('passwordsDoNotMatch');
    }

    return null;
  }, [
    credentials.confirmPassword,
    credentials.name,
    credentials.password,
    isSignUpMode,
    t,
  ]);

  const handleSubmit = async () => {
    setLocalError(null);

    if (isSignUpMode && validationError) {
      setLocalError(validationError);
      return;
    }

    setIsSubmitting(true);

    try {
      const attribution = isCloudSignupFunnel ? signupAttribution : undefined;
      const result = isSignUpMode
        ? isPublicSignup
          ? await submitSignupWithLifecycle(
              () =>
                signUpWithEmail(
                  credentials.name.trim(),
                  credentials.email.trim(),
                  credentials.password,
                  redirectTarget,
                ),
              attribution,
            )
          : await signUpWithEmail(
              credentials.name.trim(),
              credentials.email.trim(),
              credentials.password,
              redirectTarget,
            )
        : await signInWithEmail(
            credentials.email.trim(),
            credentials.password,
            redirectTarget,
          );

      if (result.error) {
        setLocalError(result.error.message ?? t('generic'));
        setIsSubmitting(false);
        return;
      }

      if (isCloudSignupFunnel) {
        // Persist attribution for `use-onboarding-wizard.ts` to retrieve when
        // the first workspace activates, since that happens on a later page
        // with no signup search params available.
        storeSignupAttribution(attribution ?? { source: 'direct', placement: 'direct' });
      }

      window.location.assign(redirectTarget);
    } catch {
      setLocalError(t('generic'));
      setIsSubmitting(false);
    }
  };

  const handleSocialSignIn = (provider: SocialAuthProvider) => {
    if (provider === 'github') {
      signInWithGithub(redirectTarget);
      return;
    }
    signInWithGoogle(redirectTarget);
  };

  return (
    <SignInCard
      mode={mode}
      values={credentials}
      onValueChange={(field, value) =>
        setCredentials((current) => ({ ...current, [field]: value }))
      }
      onSubmit={handleSubmit}
      isLoading={isLoading || isSubmitting}
      error={errorMessage}
      socialProviders={socialProviders}
      onSocialSignIn={handleSocialSignIn}
      showSignUpLink={showSignUpLink}
      signUpHref={signUpHref}
      showInvitationHint={showInvitationHint}
    />
  );
};

export const SignInContainer = ({
  mode,
  socialProviders,
  signupAttribution,
  showSignUpLink,
  signUpHref,
  showInvitationHint,
  isPublicSignUp = false,
}: {
  mode: AuthPageMode;
  socialProviders?: EnabledAuthProviders;
  signupAttribution?: SignupAttribution;
  showSignUpLink?: boolean;
  signUpHref?: string;
  showInvitationHint?: boolean;
  isPublicSignUp?: boolean;
}) => {
  return (
    <Suspense>
      <SignInContent
        mode={mode}
        socialProviders={socialProviders}
        signupAttribution={signupAttribution}
        showSignUpLink={showSignUpLink}
        signUpHref={signUpHref}
        showInvitationHint={showInvitationHint}
        isPublicSignUp={isPublicSignUp}
      />
    </Suspense>
  );
};
