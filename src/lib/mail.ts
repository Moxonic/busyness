import nodemailer, { type Transporter } from "nodemailer";
import { env } from "@/env";

export type Mail = { to: string; subject: string; text: string };

/** Emails "sent" with MAIL_TRANSPORT=console. Tests read links from here. */
export const consoleOutbox: Mail[] = [];

let transport: Transporter | undefined;

/** Sends an email. Swapping provider only needs a different SMTP_URL (Brevo, Mailjet, Scaleway...). */
export async function sendMail(mail: Mail): Promise<void> {
  const e = env();
  if (e.MAIL_TRANSPORT === "console") {
    consoleOutbox.push(mail);
    if (e.NODE_ENV !== "test") console.info(`[mail] to=${mail.to} subject=${mail.subject}\n${mail.text}`);
    return;
  }
  transport ??= nodemailer.createTransport(e.SMTP_URL);
  await transport.sendMail({ from: e.MAIL_FROM, to: mail.to, subject: mail.subject, text: mail.text });
}

// Invitees have no language preference yet, so these emails are bilingual.
export function inviteMail(to: string, link: string, companyName: string, inviterName: string): Mail {
  const company = companyName || "Busyness";
  return {
    to,
    subject: `Invitasjon til ${company} / Invitation to ${company}`,
    text: [
      `${inviterName} har invitert deg til regnskapssystemet for ${company}.`,
      `Åpne lenken for å lage brukeren din (gyldig i 7 dager):`,
      link,
      ``,
      `${inviterName} has invited you to the accounting system for ${company}.`,
      `Open the link to create your account (valid for 7 days):`,
      link,
      ``,
      `Fikk du denne e-posten ved en feil, kan du se bort fra den. / If this was not meant for you, ignore it.`,
    ].join("\n"),
  };
}

export function passwordResetMail(to: string, link: string): Mail {
  return {
    to,
    subject: "Tilbakestill passord / Reset password",
    text: [
      `Noen (forhåpentligvis du) ba om å tilbakestille passordet ditt. Lenken er gyldig i 1 time:`,
      link,
      ``,
      `Someone (hopefully you) asked to reset your password. The link is valid for 1 hour:`,
      link,
      ``,
      `Ba du ikke om dette, kan du se bort fra e-posten. Passordet ditt er uendret.`,
      `If you did not ask for this, ignore this email. Your password is unchanged.`,
    ].join("\n"),
  };
}
