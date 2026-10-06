package seurat.adapters.in.net.h3;

import java.io.ByteArrayInputStream;
import java.io.EOFException;
import java.io.IOException;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import seurat.kit.TestKit;

public final class H3WireTest {
    public static void main(String[] args) throws Exception {
        testReadVarint();
        testFrameAndReadPayload();
        testControlPreface();
        testHeaders();
        testConnectRequest();
        System.out.println("H3WireTest OK");
    }

    private static void testReadVarint() throws Exception {
        checkVarint("25", 37L);
        checkVarint("7bbd", 15293L);
        checkVarint("9d7f3e7d", 494878333L);
        checkVarint("c2197c5eff14e88c", 151288809941952652L);

        boolean threw = false;
        try {
            H3Wire.readVarint(new ByteArrayInputStream(new byte[0]));
        } catch (EOFException e) {
            threw = true;
        }
        TestKit.check(threw, "expected EOFException on empty stream");
    }

    private static void checkVarint(String hex, long expected) throws Exception {
        ByteArrayInputStream in = new ByteArrayInputStream(TestKit.unhex(hex));
        long val = H3Wire.readVarint(in);
        TestKit.check(val == expected, "varint mismatch for " + hex + ": got " + val);
    }

    private static void testFrameAndReadPayload() throws Exception {
        byte[] frame = H3Wire.frame(0x04, new byte[]{1, 2});
        TestKit.check("04020102".equals(TestKit.hex(frame)), "frame hex mismatch: " + TestKit.hex(frame));

        ByteArrayInputStream in = new ByteArrayInputStream(frame);
        long type = H3Wire.readVarint(in);
        TestKit.check(type == 0x04, "expected type 0x04");
        byte[] payload = H3Wire.readPayload(in, 10);
        TestKit.check(Arrays.equals(payload, new byte[]{1, 2}), "payload mismatch");

        ByteArrayInputStream inRefuse = new ByteArrayInputStream(frame);
        H3Wire.readVarint(inRefuse);
        boolean refused = false;
        try {
            H3Wire.readPayload(inRefuse, 1);
        } catch (IOException e) {
            refused = true;
        }
        TestKit.check(refused, "expected IOException when length exceeds max");
    }

    private static void testControlPreface() {
        String expected = "00041b0100070008013301ab60374201c0000000c671706a0194e9cd2901";
        TestKit.check(expected.equals(TestKit.hex(H3Settings.controlPreface())), "controlPreface mismatch");
    }

    private static void testHeaders() throws Exception {
        byte[] accepted = H3Headers.accepted();
        String expected = "01290000d927157365632d7765627472616e73706f72742d68747470332d64726166740764726166743032";
        TestKit.check(expected.equals(TestKit.hex(accepted)), "accepted hex mismatch: " + TestKit.hex(accepted));

        byte[] block = Arrays.copyOfRange(accepted, 2, accepted.length);
        List<Map.Entry<String, String>> decoded = H3Headers.decode(block);
        TestKit.check(decoded.size() == 2, "expected 2 headers");
        TestKit.check(":status".equals(decoded.get(0).getKey()) && "200".equals(decoded.get(0).getValue()), "status 200");
        TestKit.check("sec-webtransport-http3-draft".equals(decoded.get(1).getKey())
                && "draft02".equals(decoded.get(1).getValue()), "draft02");

        byte[] status404 = H3Headers.status(404);
        byte[] statusBlock = Arrays.copyOfRange(status404, 2, status404.length);
        List<Map.Entry<String, String>> decoded404 = H3Headers.decode(statusBlock);
        TestKit.check(decoded404.size() == 1, "expected 1 header");
        TestKit.check(":status".equals(decoded404.get(0).getKey()) && "404".equals(decoded404.get(0).getValue()), "status 404");
    }

    private static void testConnectRequest() {
        List<Map.Entry<String, String>> chromeHeaders = List.of(
            Map.entry(":scheme", "https"),
            Map.entry(":method", "CONNECT"),
            Map.entry(":authority", "127.0.0.1:4433"),
            Map.entry(":path", "/seurat/v1/lienzo"),
            Map.entry(":protocol", "webtransport"),
            Map.entry("sec-webtransport-http3-draft02", "1"),
            Map.entry("origin", "http://localhost:8099")
        );
        ConnectRequest req = ConnectRequest.of(chromeHeaders);
        TestKit.check(req.opensCanvas(), "expected opensCanvas() true for chrome headers");
        TestKit.check("CONNECT".equals(req.method()), "method mismatch");
        TestKit.check("webtransport".equals(req.protocol()), "protocol mismatch");
        TestKit.check("/seurat/v1/lienzo".equals(req.path()), "path mismatch");
        TestKit.check("127.0.0.1:4433".equals(req.authority()), "authority mismatch");
        TestKit.check("http://localhost:8099".equals(req.origin()), "origin mismatch");

        List<Map.Entry<String, String>> otherPath = List.of(
            Map.entry(":method", "CONNECT"),
            Map.entry(":path", "/other"),
            Map.entry(":protocol", "webtransport")
        );
        TestKit.check(!ConnectRequest.of(otherPath).opensCanvas(), "expected false for /other path");

        List<Map.Entry<String, String>> getMethod = List.of(
            Map.entry(":method", "GET"),
            Map.entry(":path", "/seurat/v1/lienzo"),
            Map.entry(":protocol", "webtransport")
        );
        TestKit.check(!ConnectRequest.of(getMethod).opensCanvas(), "expected false for GET method");

        List<Map.Entry<String, String>> wtH3 = List.of(
            Map.entry(":method", "CONNECT"),
            Map.entry(":path", "/seurat/v1/lienzo"),
            Map.entry(":protocol", "webtransport-h3")
        );
        TestKit.check(ConnectRequest.of(wtH3).opensCanvas(), "expected true for webtransport-h3 protocol");
    }
}
