# Security

`signing-key.asc` is the public key used to verify Fulvid Linux artifacts when a release includes PGP signatures (`SHA256SUMS.asc` and related `.asc` files). The matching private key is not in this repository.

Project PGP is not Windows Authenticode, Apple code signing, or Debian `debsign`.

Fingerprint:

```text
0AFF 5507 8845 4862 6087 F84A 5E1E 335B 601F B44B
```

```bash
gpg --import security/signing-key.asc
```

Confirm the fingerprint above before trusting it. GitHub Actions does not sign with this key. How to check a release: [docs/DISTRIBUTION.md](../docs/DISTRIBUTION.md#verification). Vulnerability reports: [SECURITY.md](../SECURITY.md).
