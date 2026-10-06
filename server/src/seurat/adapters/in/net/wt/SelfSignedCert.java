package seurat.adapters.in.net.wt;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.security.Signature;
import java.security.cert.Certificate;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.security.spec.ECGenParameterSpec;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HexFormat;
import seurat.core.shared.config.SeuratConstants;

/**
 * The certificate of the WebTransport listener: ECDSA P-256, self-signed, 13 days. The viewer pins
 * its SHA-256 (serverCertificateHashes), so no authority has to sign it and nothing is installed.
 */
public record SelfSignedCert(KeyStore store, X509Certificate certificate) {
    public static final String ALIAS = "seurat-wt";
    /** In-memory keystore only: the password protects nothing. */
    public static final char[] PASSWORD = new char[0];

    private static final String KEY_ALGORITHM = "EC";
    private static final String EC_CURVE = "secp256r1";
    private static final String SIG_ALGORITHM = "SHA256withECDSA";
    private static final String CERT_TYPE = "X.509";
    private static final String KEYSTORE_TYPE = "PKCS12";
    private static final String HASH_ALGORITHM = "SHA-256";

    private static final String OID_ECDSA_SHA256 = "1.2.840.10045.4.3.2";
    private static final String OID_COMMON_NAME = "2.5.4.3";
    private static final String OID_SUBJECT_ALT_NAME = "2.5.29.17";
    private static final String COMMON_NAME = "seurat";
    private static final String HOST_LOCALHOST = "localhost";

    private static final int TAG_EXPLICIT_VERSION = 0xA0;
    private static final int TAG_EXPLICIT_EXTENSIONS = 0xA3;
    private static final int TAG_SAN_DNS = 0x82;
    private static final int TAG_SAN_IP = 0x87;
    private static final int SERIAL_BITS = 63;

    private static final byte[] IPV4_LOOPBACK = new byte[]{127, 0, 0, 1};
    private static final byte[] IPV6_LOOPBACK = new byte[]{
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1
    };

    public static SelfSignedCert generate(Instant now) throws GeneralSecurityException {
        KeyPairGenerator kpg = KeyPairGenerator.getInstance(KEY_ALGORITHM);
        kpg.initialize(new ECGenParameterSpec(EC_CURVE));
        KeyPair keyPair = kpg.generateKeyPair();

        byte[] name = Der.sequence(Der.set(Der.sequence(
                Der.oid(OID_COMMON_NAME),
                Der.utf8(COMMON_NAME))));

        byte[] sanSeq = Der.sequence(
                Der.tlv(TAG_SAN_DNS, HOST_LOCALHOST.getBytes(StandardCharsets.US_ASCII)),
                Der.tlv(TAG_SAN_IP, IPV4_LOOPBACK),
                Der.tlv(TAG_SAN_IP, IPV6_LOOPBACK));

        byte[] extensions = Der.tlv(TAG_EXPLICIT_EXTENSIONS, Der.sequence(
                Der.sequence(
                        Der.oid(OID_SUBJECT_ALT_NAME),
                        Der.octetString(sanSeq))));

        byte[] tbs = Der.sequence(
                Der.tlv(TAG_EXPLICIT_VERSION, Der.integer(BigInteger.TWO)),
                Der.integer(new BigInteger(SERIAL_BITS, new SecureRandom()).add(BigInteger.ONE)),
                Der.sequence(Der.oid(OID_ECDSA_SHA256)),
                name,
                Der.sequence(
                        Der.utcTime(now.minusSeconds(SeuratConstants.WT_CERT_BACKDATE_S)),
                        Der.utcTime(now.plus(SeuratConstants.WT_CERT_DAYS, ChronoUnit.DAYS))),
                name,
                keyPair.getPublic().getEncoded(),
                extensions);

        Signature signer = Signature.getInstance(SIG_ALGORITHM);
        signer.initSign(keyPair.getPrivate());
        signer.update(tbs);
        byte[] signature = signer.sign();

        byte[] certDer = Der.sequence(
                tbs,
                Der.sequence(Der.oid(OID_ECDSA_SHA256)),
                Der.bitString(signature));

        CertificateFactory factory = CertificateFactory.getInstance(CERT_TYPE);
        X509Certificate cert = (X509Certificate) factory.generateCertificate(
                new ByteArrayInputStream(certDer));

        KeyStore store = KeyStore.getInstance(KEYSTORE_TYPE);
        try {
            store.load(null, null);
        } catch (IOException e) {
            throw new GeneralSecurityException(e);
        }
        store.setKeyEntry(ALIAS, keyPair.getPrivate(), PASSWORD, new Certificate[]{cert});

        return new SelfSignedCert(store, cert);
    }

    /** What the viewer pins: SHA-256 of the DER certificate, in lowercase hex. */
    public String sha256Hex() {
        try {
            byte[] digest = MessageDigest.getInstance(HASH_ALGORITHM).digest(certificate.getEncoded());
            return HexFormat.of().formatHex(digest);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }
}
