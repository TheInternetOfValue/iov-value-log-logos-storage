# Database backup CA

`supabase-root-2021.crt` is the public Supabase Root 2021 CA, downloaded from the certificate link in the authenticated Value Log project's Database → Settings → SSL configuration on 25 October 2026.

Source: https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt

SHA-256 certificate fingerprint: `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`.

This is public trust material, not an authentication credential. Only the local backup helper uses it, with `sslmode=verify-full` and an exact fingerprint check. It is not installed in the system trust store and does not alter application, Supabase or browser security settings. Verify a future replacement against Supabase's official dashboard and update the pin deliberately.
