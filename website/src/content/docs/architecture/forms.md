---
title: Forms & validation
description: Building forms with React Hook Form, Zod v4 schemas and ControlledTextField in the React Native Expo Boilerplate, with translated error messages.
---

Forms use **React Hook Form** for state and **Zod** for validation, joined by `zodResolver`. The `ControlledTextField` component connects an input to the form and shows its error under the field.

## A complete form

This is the pattern the login screen uses. Error messages come from translations, so the schema is built inside the component with the `t` function:

```tsx
import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { useTranslate } from '@/localization/utils';
import Button from '@/shared/components/Button';
import { ControlledTextField } from '@/shared/components/ControlledTextField';
import ScreenWrapper from '@/shared/components/ScreenWrapper';

const getSchema = (t: ReturnType<typeof useTranslate>) =>
  z.object({
    email: z
      .string({ error: t('validation.email_required') })
      .min(1, t('validation.email_required'))
      .email(t('validation.email_invalid')),
    password: z
      .string({ error: t('validation.password_required') })
      .min(6, t('validation.password_min_length')),
  });

type FormData = z.infer<ReturnType<typeof getSchema>>;

export function SignUpScreen() {
  const t = useTranslate();
  const schema = React.useMemo(() => getSchema(t), [t]);

  const { control, handleSubmit } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = (data: FormData) => {
    // call a mutation hook here
  };

  return (
    <ScreenWrapper>
      <ControlledTextField<FormData>
        control={control}
        name="email"
        placeholder={t('auth.enter_email')}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <ControlledTextField<FormData>
        control={control}
        name="password"
        placeholder={t('auth.enter_password')}
        secureTextEntry
      />
      <Button title={t('auth.login')} onPress={handleSubmit(onSubmit)} />
    </ScreenWrapper>
  );
}
```

## Tips

- **Type the field names.** `ControlledTextField<FormData>` makes `name` a typed key of your form, so a typo is a compile error.
- **Rebuild the schema when the language changes.** `useMemo(() => getSchema(t), [t])` keeps messages in the current language.
- **Keep `ControlledTextField` for forms, `TextField` for everything else.** `TextField` is the plain styled input, for search boxes and other inputs that aren't part of a form.
- **Warn before leaving a half-filled form.** Pass the form's dirty state to `useBlockBackNavigation(isDirty)`.
- **Keyboard handling is done for you.** `react-native-keyboard-controller` is set up in the providers, and `ScreenWrapper` scrolls focused inputs above the keyboard.
- **Show progress on submit.** `Button` takes `isLoading`, which shows a spinner and disables the button.
