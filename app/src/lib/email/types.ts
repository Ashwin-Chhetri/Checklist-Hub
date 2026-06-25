export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendEmailResult {
  id?: string;
}

export interface EmailProvider {
  sendEmail(input: SendEmailInput): Promise<SendEmailResult>;
}
