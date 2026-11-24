# Live vision validation — November 7, 2026

Completed at 16:54 Asia/Dubai against NVIDIA's hosted endpoint with a normally
created free validation key. No key value is included in this report or repo.

Candidate: `meta/llama-3.2-90b-vision-instruct`.
Primary retained: `nvidia/nemotron-3.5-super-vl-120b-a12b` (not retested live).

Used the existing JPEG fixtures, unchanged `visionGate`, `gatePrompt`, 512px
resize, `parseGateVerdict`, and `gateDecision`. Subject was “mountain lake in
Kyrgyzstan”; candidate pinned explicitly, no other models tried for controls.

| Control | Expected | Actual |
| --- | --- | --- |
| clean-landscape.jpg | accept | accepted; all four unwanted-feature flags false; is_photo and matches_subject true |
| text-overlay.jpg | reject | rejected; has_text true (also matches_subject false) |
| logo-corner.jpg | reject | rejected; has_logo true |

All controls returned parseable boolean schema fields, not operational-error
fail-closed substitutes. No blog generation, image upload, publishing or paid
purchase occurred. Gate calls were sequential; no deliberate live throttling
was induced. Real provider 429/timeout behavior is covered deterministically,
not demonstrated through intentionally exhausting the API.

Fixture SHA-256:

```
48bc6604260af3f7faf94b438d0c93bf0ce9bb5bfa81c494438d31ce3ce7c95a  clean-landscape.jpg
9cbd0a63c2baa0cdbda1e7396b3dd4f0590088558ddc8343290d8608cbb41937  text-overlay.jpg
3bd745a13af880bf78be3c1ad5ddeeb99fd6ef5e32b4d5710f095c012eed388e  logo-corner.jpg
```

Offline verification: 18 rotation tests and 150 existing image-finder checks
passed. Coverage includes ordered rotation, timeout/5xx/429, full Retry-After,
shared spacing/cooldown, total call/sleep budget, valid rejections, malformed
output, non-operational failures, and fail-closed exhaustion. No criteria or
JSON-validation relaxation was needed. This is a compatibility smoke test, not
proof of equivalent accuracy on all travel images or independent rate quotas.
