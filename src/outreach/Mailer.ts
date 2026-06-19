/**
 * SMTP send over Gmail / Outlook using the app passwords already in .env (the
 * same credentials ImapClient reads for the inbox). The from-address IS the
 * SMTP user, so sender identity needs no separate config.
 *
 * The one hard rule, from the 2026-06-16 LIVE-submit lesson (a submit was
 * recorded the instant the click returned, before the ATS accepted it, a false
 * green): a send counts as confirmed ONLY when the server accepted the message
 * for this exact recipient and rejected nobody. The Mailer returns that verdict
 * and records nothing itself; the orchestrator owns event recording (one layer).
 */

import nodemailer from 'nodemailer';
import type { EmailDraft, SendAccount } from './types.js';

export interface Attachment {
  filename: string;
  path: string;
}

export interface SentInfo {
  accepted: string[];
  rejected: string[];
  messageId?: string;
  response?: string;
}

export type SendMailFn = (msg: {
  from: string;
  to: string;
  subject: string;
  text: string;
  attachments?: Attachment[];
}) => Promise<SentInfo>;

export interface AccountTransport {
  /** The address mail is sent from (the SMTP user). */
  from: string;
  send: SendMailFn;
}

export type SendResult =
  | { confirmed: true; messageId?: string }
  | { confirmed: false; reason: string };

function norm(s: string): string {
  return s.toLowerCase().trim();
}

export class Mailer {
  constructor(
    private readonly accounts: Partial<Record<SendAccount, AccountTransport>>,
    private readonly displayName: string
  ) {}

  /**
   * Build a Mailer from environment app passwords. Gmail uses implicit TLS on
   * 465; Outlook uses STARTTLS on 587. An account with no credentials is simply
   * absent, and a draft routed to it returns an unconfirmed result rather than
   * throwing.
   */
  static fromEnv(displayName: string, env: NodeJS.ProcessEnv = process.env): Mailer {
    const accounts: Partial<Record<SendAccount, AccountTransport>> = {};

    if (env.GMAIL_USER && env.GMAIL_APP_PASSWORD) {
      accounts.gmail = Mailer.transport('smtp.gmail.com', 465, true, env.GMAIL_USER, env.GMAIL_APP_PASSWORD);
    }
    if (env.OUTLOOK_USER && env.OUTLOOK_APP_PASSWORD) {
      accounts.outlook = Mailer.transport('smtp-mail.outlook.com', 587, false, env.OUTLOOK_USER, env.OUTLOOK_APP_PASSWORD);
    }
    return new Mailer(accounts, displayName);
  }

  /** Which sending accounts are configured. */
  available(): SendAccount[] {
    return Object.keys(this.accounts) as SendAccount[];
  }

  async send(draft: EmailDraft, attachments: Attachment[] = []): Promise<SendResult> {
    const acct = this.accounts[draft.fromAccount];
    if (!acct) {
      return { confirmed: false, reason: `no transport configured for account "${draft.fromAccount}"` };
    }

    let info: SentInfo;
    try {
      info = await acct.send({
        from: `"${this.displayName}" <${acct.from}>`,
        to: draft.to,
        subject: draft.subject,
        text: draft.body,
        attachments,
      });
    } catch (err) {
      return { confirmed: false, reason: `smtp error: ${(err as Error).message}` };
    }

    const accepted = info.accepted.map(norm).includes(norm(draft.to));
    const rejectedNobody = info.rejected.length === 0;
    if (accepted && rejectedNobody) {
      return { confirmed: true, messageId: info.messageId };
    }
    return {
      confirmed: false,
      reason: `server did not confirm delivery to ${draft.to} (rejected: ${info.rejected.join(', ') || 'none'}; response: ${info.response ?? 'none'})`,
    };
  }

  private static transport(
    host: string,
    port: number,
    secure: boolean,
    user: string,
    pass: string
  ): AccountTransport {
    const tx = nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
    return {
      from: user,
      send: async (msg) => {
        const info = await tx.sendMail(msg);
        return {
          accepted: (info.accepted ?? []).map((a) => (typeof a === 'string' ? a : String(a))),
          rejected: (info.rejected ?? []).map((a) => (typeof a === 'string' ? a : String(a))),
          messageId: info.messageId,
          response: info.response,
        };
      },
    };
  }
}
