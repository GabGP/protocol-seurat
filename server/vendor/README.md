# Vendored jars

Pure-Java libraries the JDK has no equivalent for. Nothing is downloaded at build, boot or
grade time: these files are on the classpath as they are. One line per jar:
`artifact:version:license` and the SHA-256 of the file.

| Jar | License | SHA-256 |
|---|---|---|
| tech.kwik:kwik:0.11 (QUIC, RFC 9000, 9001, 9002, 9221) | LGPL-3.0 | 89466a33cc8a3cf5fbe2f351731dd5b02294bda6277a476eac64cd29734c8cd5 |
| tech.kwik:agent15:3.3 (TLS 1.3 for QUIC) | LGPL-3.0 | eb0a5a3573744e54928b56956b9eadff5d1312675905ee8a657a08d6e1c17519 |
| tech.kwik:qpack:2.0.1 (HTTP/3 header compression, RFC 9204) | LGPL-3.0 | fb19ffc5367b394c22edd57c3106e8070407fe153e0d64966f7950f5ed3ac638 |
| at.favre.lib:hkdf:2.0.0 (HKDF, used by kwik) | Apache-2.0 | 65aa13f71a1a8b9cac439504af213d761fef9b002b6d06f06c16e50f86ec422b |
| com.io7m.repackage.io.whitfin:io.whitfin.siphash:2.0.1 (SipHash, used by kwik) | MIT | 95b6678908a4d69c0ef6510e960fae2d38511a57e13fc1b4408c658162c3a07f |

Source: Maven Central (`repo1.maven.org/maven2`). Only `seurat.adapters.in.net.h3` and
`seurat.adapters.in.net.wt` import them.
