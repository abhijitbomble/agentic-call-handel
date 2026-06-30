import { TwilioSetup } from "@/components/twilio-setup";

export const metadata = { title: "Twilio and Browser Calls | VoiceOps Control" };

export default function TwilioPage() {
  return (
    <main className="page-content">
      <div className="page-header">
        <h1 className="page-title">Real Call Integration</h1>
        <p className="page-subtitle">
          Test the live AI call runtime through Twilio phone calls or a browser softphone that reuses the same business-logic path.
        </p>
      </div>
      <TwilioSetup />
    </main>
  );
}
