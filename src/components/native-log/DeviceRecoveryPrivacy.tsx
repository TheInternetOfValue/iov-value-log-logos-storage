export function DeviceRecoveryPrivacy() {
  return (
    <p>
      While you record, pending audio and upload progress can be encrypted on
      this device for up to 24 hours. Recovery requires the same account to sign
      in again before expiry. The encryption key is not saved in browser
      storage. Submission or explicit removal clears local audio; expired
      encrypted chunks are cleared when you next open the app. Browser storage
      can be denied, cleared or evicted, so recovery is available only when the
      app confirms a device save. Audio is sent to Sarvam for processing; Value
      Log does not store audio on its server.
    </p>
  );
}
