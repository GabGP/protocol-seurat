package seurat.adapters.in.net.h3;

import java.util.List;
import java.util.Map;
import seurat.core.shared.config.SeuratConstants;

/** The extended CONNECT that opens a WebTransport session (RFC 9220): what the server checks. */
public record ConnectRequest(String method, String protocol, String path, String authority, String origin) {
    public static final String PATH = SeuratConstants.WT_PATH;
    public static final String METHOD_CONNECT = "CONNECT";
    public static final String PROTOCOL_WT = "webtransport";
    public static final String PROTOCOL_WT_H3 = "webtransport-h3";

    public static final String HEADER_METHOD = ":method";
    public static final String HEADER_PROTOCOL = ":protocol";
    public static final String HEADER_PATH = ":path";
    public static final String HEADER_AUTHORITY = ":authority";
    public static final String HEADER_ORIGIN = "origin";

    public static ConnectRequest of(List<Map.Entry<String, String>> headers) {
        String method = "";
        String protocol = "";
        String path = "";
        String authority = "";
        String origin = "";
        for (Map.Entry<String, String> entry : headers) {
            String key = entry.getKey();
            String val = entry.getValue() != null ? entry.getValue() : "";
            if (HEADER_METHOD.equals(key)) {
                method = val;
            } else if (HEADER_PROTOCOL.equals(key)) {
                protocol = val;
            } else if (HEADER_PATH.equals(key)) {
                path = val;
            } else if (HEADER_AUTHORITY.equals(key)) {
                authority = val;
            } else if (HEADER_ORIGIN.equals(key)) {
                origin = val;
            }
        }
        return new ConnectRequest(method, protocol, path, authority, origin);
    }

    /** CONNECT with :protocol webtransport (browsers today) or webtransport-h3 (later drafts), on the canvas path. */
    public boolean opensCanvas() {
        return METHOD_CONNECT.equals(method)
                && PATH.equals(path)
                && (PROTOCOL_WT.equals(protocol) || PROTOCOL_WT_H3.equals(protocol));
    }
}
