package seurat.adapters.in.net.wt;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.interfaces.ECPublicKey;
import java.time.Instant;
import java.util.Date;
import java.util.HexFormat;
import java.util.List;
import seurat.kit.TestKit;

public final class SelfSignedCertTest {
    private static final int DUMMY_TAG = 0x04;
    private static final int TEST_LEN_200 = 200;
    private static final int TEST_LEN_300 = 300;
    private static final int TAG_UTC_TIME = 0x17;
    private static final int LEN_UTC_TIME = 0x0D;
    private static final int EXPECTED_VERSION = 3;
    private static final int EXPECTED_KEY_BITS = 256;
    private static final int SHA256_HEX_LEN = 64;
    private static final long MS_PER_DAY = 24L * 3600 * 1000;
    private static final long MIN_DAYS = 12;
    private static final long MAX_DAYS = 14;

    public static void main(String[] args) throws Exception {
        testDerEncoders();
        testCertificateGeneration();
        System.out.println("SelfSignedCertTest OK");
    }

    private static void testDerEncoders() {
        TestKit.check(TestKit.hex(Der.oid("1.2.840.10045.4.3.2")).equals("06082a8648ce3d040302"),
                "oid ecdsa-sha256 encoding");
        TestKit.check(TestKit.hex(Der.oid("2.5.4.3")).equals("0603550403"),
                "oid common-name encoding");
        TestKit.check(TestKit.hex(Der.integer(BigInteger.TWO)).equals("020102"),
                "integer two encoding");

        byte[] tlv200 = Der.tlv(DUMMY_TAG, new byte[TEST_LEN_200]);
        TestKit.check(TestKit.hex(tlv200).startsWith("0481c8"),
                "tlv 200 length header");

        byte[] tlv300 = Der.tlv(DUMMY_TAG, new byte[TEST_LEN_300]);
        TestKit.check(TestKit.hex(tlv300).startsWith("0482012c"),
                "tlv 300 length header");

        byte[] utc = Der.utcTime(Instant.parse("2026-10-06T12:30:00Z"));
        TestKit.check(utc[0] == TAG_UTC_TIME, "utcTime tag");
        TestKit.check(utc[1] == LEN_UTC_TIME, "utcTime length");
        String utcAscii = new String(utc, 2, utc.length - 2, StandardCharsets.US_ASCII);
        TestKit.check("261006123000Z".equals(utcAscii), "utcTime ASCII value");
    }

    private static void testCertificateGeneration() throws Exception {
        Instant now = Instant.parse("2026-10-06T12:00:00Z");
        SelfSignedCert c = SelfSignedCert.generate(now);

        c.certificate().verify(c.certificate().getPublicKey());
        c.certificate().checkValidity(Date.from(now));

        long validityMs = c.certificate().getNotAfter().getTime() - c.certificate().getNotBefore().getTime();
        TestKit.check(validityMs <= MAX_DAYS * MS_PER_DAY, "validity at most 14 days");
        TestKit.check(validityMs > MIN_DAYS * MS_PER_DAY, "validity more than 12 days");

        TestKit.check(c.certificate().getVersion() == EXPECTED_VERSION, "X.509 version 3");
        TestKit.check("SHA256withECDSA".equalsIgnoreCase(c.certificate().getSigAlgName()),
                "sig alg name");

        TestKit.check(c.certificate().getPublicKey() instanceof ECPublicKey ec
                && ec.getParams().getOrder().bitLength() == EXPECTED_KEY_BITS,
                "ECDSA P-256 public key");

        boolean hasLocalhost = false;
        var sans = c.certificate().getSubjectAlternativeNames();
        if (sans != null) {
            for (List<?> san : sans) {
                if (san.contains("localhost")) {
                    hasLocalhost = true;
                    break;
                }
            }
        }
        TestKit.check(hasLocalhost, "SAN contains localhost");

        TestKit.check(c.store().getKey(SelfSignedCert.ALIAS, SelfSignedCert.PASSWORD) != null,
                "keystore contains entry");

        String hex = c.sha256Hex();
        TestKit.check(hex.length() == SHA256_HEX_LEN, "sha256 length 64");
        byte[] expectedHash = MessageDigest.getInstance("SHA-256").digest(c.certificate().getEncoded());
        TestKit.check(hex.equals(HexFormat.of().formatHex(expectedHash)), "sha256 matches cert bytes");

        SelfSignedCert c2 = SelfSignedCert.generate(now);
        TestKit.check(!hex.equals(c2.sha256Hex()), "different certificates produce different hashes");
    }
}
