package seurat.catalog;

import java.util.HashMap;
import java.util.Map;
import seurat.codec.Geometry;
import seurat.store.WorkMeta;

/** Minimal meta.json reader/writer. No dependencies. Ids are filenames and may hold commas. */
final class MetaJson {
    private static final String CEILING = "techo.";

    private MetaJson() {}

    static String write(WorkRecord work) {
        WorkMeta m = work.meta;
        return "{\"id\":\"" + esc(m.id()) + "\",\"name\":\"" + esc(m.name())
                + "\",\"width\":" + m.width() + ",\"height\":" + m.height()
                + ",\"side\":" + m.side() + ",\"strata\":" + m.strata()
                + ",\"state\":" + m.state() + ",\"edition\":" + m.edition()
                + ",\"keepMaster\":" + work.keepMaster + ceilings(work) + "}";
    }

    /** Absent (older meta.json) means kept: nothing is deleted that was not asked for. */
    static boolean keepMaster(String json) {
        return !"false".equals(parse(json).get("keepMaster"));
    }

    /** Ceilings per role (spec 8: meta.json holds them), as "techo.<role>":"stratum/bands". */
    private static String ceilings(WorkRecord work) {
        StringBuilder b = new StringBuilder();
        for (String role : WorkRecord.ROLES) {
            long[] c = work.ceiling(role);
            b.append(",\"").append(CEILING).append(role).append("\":\"").append(c[0]).append('/').append(c[1]).append('"');
        }
        return b.toString();
    }

    /** The ceilings meta.json records, valid ones only; absent or broken ones keep the defaults. */
    static Map<String, long[]> ceilings(String json) {
        Map<String, long[]> out = new HashMap<>();
        for (var e : parse(json).entrySet()) {
            String[] v = e.getValue().split("/");
            if (e.getKey().startsWith(CEILING) && v.length == 2 && v[0].matches("\\d{1,2}") && v[1].matches("\\d")) {
                out.put(e.getKey().substring(CEILING.length()), new long[]{Long.parseLong(v[0]), Long.parseLong(v[1])});
            }
        }
        return out;
    }

    static WorkMeta read(String id, String json) {
        Map<String, String> m = parse(json);
        return new WorkMeta(m.getOrDefault("id", id), m.getOrDefault("name", id),
                Integer.parseInt(m.getOrDefault("width", "0")),
                Integer.parseInt(m.getOrDefault("height", "0")),
                Integer.parseInt(m.getOrDefault("side", Integer.toString(Geometry.SIDE))),
                Integer.parseInt(m.getOrDefault("strata", "0")),
                Integer.parseInt(m.getOrDefault("state", "3")),
                Long.parseLong(m.getOrDefault("edition", "2")), 0, 2);
    }

    /** Quote-aware object scan: string values keep commas, colons and braces. */
    static Map<String, String> parse(String json) {
        Map<String, String> m = new HashMap<>();
        int i = 0;
        while (i < json.length()) {
            int k0 = json.indexOf('"', i);
            if (k0 < 0) return m;
            int k1 = endQuote(json, k0);
            if (k1 < 0) return m;
            String key = unesc(json.substring(k0 + 1, k1));
            int c = json.indexOf(':', k1);
            if (c < 0) return m;
            int v = c + 1;
            while (v < json.length() && Character.isWhitespace(json.charAt(v))) v++;
            if (v < json.length() && json.charAt(v) == '"') {
                int v1 = endQuote(json, v);
                if (v1 < 0) return m;
                m.put(key, unesc(json.substring(v + 1, v1)));
                i = v1 + 1;
            } else {
                int e = v;
                while (e < json.length() && json.charAt(e) != ',' && json.charAt(e) != '}') e++;
                m.put(key, json.substring(v, e).trim());
                i = e + 1;
            }
        }
        return m;
    }

    private static int endQuote(String s, int open) {
        for (int i = open + 1; i < s.length(); i++) {
            char ch = s.charAt(i);
            if (ch == '\\') {
                i++;
            } else if (ch == '"') {
                return i;
            }
        }
        return -1;
    }

    private static String esc(String s) {
        StringBuilder b = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '"' || c == '\\') b.append('\\');
            b.append(c);
        }
        return b.toString();
    }

    private static String unesc(String s) {
        if (s.indexOf('\\') < 0) return s;
        StringBuilder b = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '\\' && i + 1 < s.length()) {
                char e = s.charAt(++i);
                b.append(switch (e) {
                    case 'n' -> '\n';
                    case 'r' -> '\r';
                    case 't' -> '\t';
                    default -> e;
                });
            } else {
                b.append(c);
            }
        }
        return b.toString();
    }
}
