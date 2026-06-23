declare module "nodemailer" {
  export type SendMailOptions = {
    from: string;
    to: string;
    subject: string;
    html: string;
  };

  export type Transporter = {
    sendMail: (options: SendMailOptions) => Promise<unknown>;
  };

  const nodemailer: {
    createTransport: (options: Record<string, unknown>) => Transporter;
  };

  export default nodemailer;
}
