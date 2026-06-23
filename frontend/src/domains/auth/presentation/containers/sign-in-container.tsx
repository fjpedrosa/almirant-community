'use client';

import { Suspense, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { AuthPageMode } from '../../domain/types';
import { useAuth } from '../../application/hooks/use-auth';
import { SignInCard } from '../components/sign-in-card';

const SignInContent = ({ mode }: { mode: AuthPageMode }) => {
  const { signInWithEmail, signUpWithEmail, isLoading } = useAuth();
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

  const ERROR_KEYS: Record<string, string> = {
    unauthorized: 'unauthorized',
  };

  const errorMessage = localError
    ? localError
    : errorParam
    ? t(ERROR_KEYS[errorParam] ?? 'generic')
    : null;

  const isSignUpMode = mode === 'initial_admin_setup' || mode === 'sign_up';
  const redirectTarget =
    mode === 'initial_admin_setup'
      ? '/onboarding'
      : redirectTo || '/board';

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
      const result = isSignUpMode
        ? await signUpWithEmail(
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

      window.location.assign(redirectTarget);
    } catch {
      setLocalError(t('generic'));
      setIsSubmitting(false);
    }
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
    />
  );
};

export const SignInContainer = ({
  mode,
}: {
  mode: AuthPageMode;
}) => {
  return (
    <Suspense>
      <SignInContent mode={mode} />
    </Suspense>
  );
};
