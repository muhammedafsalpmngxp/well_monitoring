import { AbstractControl, ValidationErrors } from '@angular/forms';

export function passwordStrengthValidator(control: AbstractControl): ValidationErrors | null {
  const value: string = control.value || '';
  const hasUpperCase  = /[A-Z]/.test(value);
  const hasLowerCase  = /[a-z]/.test(value);
  const hasNumeric    = /[0-9]/.test(value);
  const hasSpecialChar= /[!@#$%^&*(),.?":{}|<>]/.test(value);
  const isLongEnough  = value.length >= 8;

  const valid = hasUpperCase && hasLowerCase && hasNumeric && hasSpecialChar && isLongEnough;
  return valid ? null : { passwordStrength: { hasUpperCase, hasLowerCase, hasNumeric, hasSpecialChar, isLongEnough } };
}

export function passwordMatchValidator(passwordKey: string, confirmPasswordKey: string) {
  return (group: AbstractControl): ValidationErrors | null => {
    const password = group.get(passwordKey)?.value;
    const confirm  = group.get(confirmPasswordKey)?.value;
    return password === confirm ? null : { passwordMismatch: true };
  };
}
