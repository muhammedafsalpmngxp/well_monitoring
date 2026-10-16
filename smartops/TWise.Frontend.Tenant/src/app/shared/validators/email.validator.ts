import { AbstractControl, ValidationErrors } from '@angular/forms';

/** Validates that the email domain matches one of the allowed domains. */
export function emailDomainValidator(allowedDomains: string[]) {
  return (control: AbstractControl): ValidationErrors | null => {
    const email: string = control.value || '';
    const domain = email.split('@')[1];
    if (!domain) return null;
    return allowedDomains.includes(domain)
      ? null
      : { emailDomain: { allowedDomains, actualDomain: domain } };
  };
}
