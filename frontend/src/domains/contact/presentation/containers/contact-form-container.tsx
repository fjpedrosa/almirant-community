"use client";

import { useContactForm } from "../../application/hooks/use-contact-form";
import { ContactForm } from "../components/contact-form";

export const ContactFormContainer = () => {
  const contactForm = useContactForm();

  return (
    <ContactForm
      form={contactForm.form}
      isSubmitting={contactForm.isSubmitting}
      isSuccess={contactForm.isSuccess}
      error={contactForm.error}
      onSubmit={contactForm.onSubmit}
    />
  );
};
