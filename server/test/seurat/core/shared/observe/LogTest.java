package seurat.core.shared.observe;

import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import seurat.core.shared.proto.FrameType;
import seurat.core.shared.proto.ProtoCodes;

public class LogTest {
    public static void main(String[] args) {
        testLogLevelParsing();
        testLevelFiltering();
        testStandardizedTagSize();
        testExceptionLogging();
        testAuditLogIntegration();
        testProtoNames();
        System.out.println("LogTest OK");
    }

    private static void testLogLevelParsing() {
        assert LogLevel.fromString("debug", LogLevel.INFO) == LogLevel.DEBUG;
        assert LogLevel.fromString("INFO", LogLevel.WARN) == LogLevel.INFO;
        assert LogLevel.fromString("warn", LogLevel.INFO) == LogLevel.WARN;
        assert LogLevel.fromString("ERROR", LogLevel.INFO) == LogLevel.ERROR;
        assert LogLevel.fromString("none", LogLevel.INFO) == LogLevel.NONE;
        assert LogLevel.fromString("invalid", LogLevel.WARN) == LogLevel.WARN;
        assert LogLevel.fromString(null, LogLevel.INFO) == LogLevel.INFO;
        assert LogLevel.fromString("", LogLevel.INFO) == LogLevel.INFO;
    }

    private static void testLevelFiltering() {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        PrintStream ps = new PrintStream(baos, true, StandardCharsets.UTF_8);
        Log.setOutput(ps);
        try {
            Log.setLevel(LogLevel.WARN);
            assert !Log.isDebugEnabled();
            assert !Log.isInfoEnabled();
            Log.debug("test", "debug message");
            Log.info("test", "info message");
            assert baos.toString(StandardCharsets.UTF_8).isEmpty() : "Expected no output below WARN";

            Log.warn("test", "warning message");
            String out = baos.toString(StandardCharsets.UTF_8);
            assert out.contains("WARN") : "Expected WARN in output";
            assert out.contains("[test      ]") : "Expected standardized tag in output";
            assert out.contains("warning message") : "Expected message in output";

            baos.reset();
            Log.setLevel(LogLevel.DEBUG);
            assert Log.isDebugEnabled();
            assert Log.isInfoEnabled();
            Log.debug("test", "hello debug");
            assert baos.toString(StandardCharsets.UTF_8).contains("hello debug");
        } finally {
            Log.setOutput(System.out);
            Log.setLevel(LogLevel.INFO);
        }
    }

    private static void testStandardizedTagSize() {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        PrintStream ps = new PrintStream(baos, true, StandardCharsets.UTF_8);
        Log.setOutput(ps);
        try {
            Log.info("ws", "short tag message");
            Log.info("catalog", "medium tag message");
            Log.info("concession", "long tag message");
            String[] lines = baos.toString(StandardCharsets.UTF_8).split("\\R");
            assert lines.length >= 3 : "Expected 3 log lines";
            for (String rawLine : lines) {
                if (rawLine.isBlank()) continue;
                String line = rawLine.replaceAll("\u001B\\[[0-9;]*m", "");
                int openBracket = line.indexOf('[');
                int closeBracket = line.indexOf(']');
                assert openBracket == 30 : "Opening bracket not at column 30: " + openBracket;
                assert closeBracket == 41 : "Closing bracket not at column 41: " + closeBracket;
                assert closeBracket - openBracket + 1 == Log.TAG_WIDTH + 2
                        : "Tag block width mismatch: " + (closeBracket - openBracket + 1);
                assert line.length() > 43 : "Line too short for message: " + line;
            }
        } finally {
            Log.setOutput(System.out);
        }
    }

    private static void testExceptionLogging() {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        PrintStream ps = new PrintStream(baos, true, StandardCharsets.UTF_8);
        Log.setOutput(ps);
        try {
            Log.setLevel(LogLevel.DEBUG);
            Exception ex = new RuntimeException("boom");
            Log.error("test", "failure occurred", ex);
            String out = baos.toString(StandardCharsets.UTF_8);
            assert out.contains("ERROR") : "Expected ERROR";
            assert out.contains("failure occurred") : "Expected message";
            assert out.contains("java.lang.RuntimeException: boom") : "Expected stack trace";
        } finally {
            Log.setOutput(System.out);
            Log.setLevel(LogLevel.INFO);
        }
    }

    private static void testAuditLogIntegration() {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        PrintStream ps = new PrintStream(baos, true, StandardCharsets.UTF_8);
        Log.setOutput(ps);
        try {
            Log.setLevel(LogLevel.DEBUG);
            AuditLog.alert("crc mismatch on brush 42");
            AuditLog.info("audit checkpoint reached");
            String out = baos.toString(StandardCharsets.UTF_8);
            assert out.contains("crc mismatch on brush 42") : "Expected alert in log";
            assert out.contains("audit checkpoint reached") : "Expected info in log";
            String[] dump = AuditLog.dump();
            assert dump.length >= 2 : "Expected items in dump queue";
        } finally {
            Log.setOutput(System.out);
            Log.setLevel(LogLevel.INFO);
        }
    }

    private static void testProtoNames() {
        assert FrameType.name(FrameType.SALUDO).equals("SALUDO");
        assert FrameType.name(FrameType.MIRADA).equals("MIRADA");
        assert FrameType.name(0x99).equals("UNKNOWN_0x99");
        assert ProtoCodes.errorName(ProtoCodes.ERR_PROTOCOLO).equals("ERR_PROTOCOLO");
        assert ProtoCodes.errorName(ProtoCodes.ERR_POSESION).equals("ERR_POSESION");
        assert ProtoCodes.stateName(ProtoCodes.ST_LISTA).equals("LISTA");
        assert ProtoCodes.motiveName(ProtoCodes.MOT_MIRADA).equals("MIRADA");
        assert ProtoCodes.eventName(ProtoCodes.OBRA_ALTA).equals("ALTA");
    }
}
