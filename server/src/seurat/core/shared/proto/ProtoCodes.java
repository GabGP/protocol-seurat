package seurat.core.shared.proto;

/** Shared numeric codes: caps, events, states, motives, predicates, errors. */
public final class ProtoCodes {
    private ProtoCodes() {}

    public static final int CAP_DATAGRAMAS = 0x01;
    public static final int CAP_REANUDAR = 0x02;
    /** ADR-07, the client reads REGULACION. */
    public static final int CAP_REGULACION = 0x04;

    public static final int OBRA_LISTADO = 0;
    public static final int OBRA_ALTA = 1;
    public static final int OBRA_ESTADO = 2;
    public static final int OBRA_EDICION = 3;
    public static final int OBRA_BAJA = 4;

    public static final int ST_RECIBIENDO = 0;
    public static final int ST_BOCETO = 1;
    public static final int ST_PINTANDO = 2;
    public static final int ST_LISTA = 3;
    public static final int ST_FALLIDA = 4;
    public static final int ST_RETIRADA = 5;

    /** OBRA edición before any store is servable: 1 is the sketch, 2 the definitive (spec 3.3). */
    public static final int ED_NINGUNA = 0;

    public static final int MOT_INICIAL = 0;
    public static final int MOT_MIRADA = 1;
    public static final int MOT_POLITICA = 2;
    public static final int MOT_OCULTA = 3;
    public static final int MOT_INACTIVIDAD = 4;
    public static final int MOT_ROL = 5;

    public static final int PLAN_INICIO = 0;
    public static final int PLAN_FIN = 1;
    public static final int PLAN_CANCELADAS = 2;

    public static final int REG_CARGA = 1;
    public static final int REG_PRESUPUESTO = 2;
    public static final int REG_COLA = 4;

    public static final int PRED_ESTRATO_BAJO = 1;
    public static final int PRED_FUERA = 2;
    public static final int PRED_BANDAS = 3;
    public static final int PRED_LISTA = 4;
    public static final int PRED_TODO = 5;

    public static final int SOLTAR_LRU = 1;
    public static final int SOLTAR_DECODIFICACION = 2;
    public static final int SOLTAR_CADUCADA = 3;
    public static final int SOLTAR_PRESUPUESTO = 4;
    public static final int SOLTAR_CONTEXTO_GPU = 5;
    public static final int SOLTAR_CRC = 6;
    public static final int SOLTAR_REEMPLAZADA = 7;

    public static final int ERR_PROTOCOLO = 1;
    public static final int ERR_VERSION = 2;
    public static final int ERR_AUTENTICACION = 3;
    public static final int ERR_OBRA_INEXISTENTE = 4;
    public static final int ERR_OBRA_NO_LISTA = 5;
    public static final int ERR_HANDLE = 6;
    public static final int ERR_POSESION = 7;
    public static final int ERR_LIQUIDACION = 8;
    public static final int ERR_TASA = 9;
    public static final int ERR_PRESUPUESTO = 10;
    public static final int ERR_INTERNO = 11;
    public static final int ERR_REANUDACION = 12;

    public static String errorName(int code) {
        return switch (code) {
            case ERR_PROTOCOLO -> "ERR_PROTOCOLO";
            case ERR_VERSION -> "ERR_VERSION";
            case ERR_AUTENTICACION -> "ERR_AUTENTICACION";
            case ERR_OBRA_INEXISTENTE -> "ERR_OBRA_INEXISTENTE";
            case ERR_OBRA_NO_LISTA -> "ERR_OBRA_NO_LISTA";
            case ERR_HANDLE -> "ERR_HANDLE";
            case ERR_POSESION -> "ERR_POSESION";
            case ERR_LIQUIDACION -> "ERR_LIQUIDACION";
            case ERR_TASA -> "ERR_TASA";
            case ERR_PRESUPUESTO -> "ERR_PRESUPUESTO";
            case ERR_INTERNO -> "ERR_INTERNO";
            case ERR_REANUDACION -> "ERR_REANUDACION";
            default -> "ERR_" + code;
        };
    }

    public static String stateName(int state) {
        return switch (state) {
            case ST_RECIBIENDO -> "RECIBIENDO";
            case ST_BOCETO -> "BOCETO";
            case ST_PINTANDO -> "PINTANDO";
            case ST_LISTA -> "LISTA";
            case ST_FALLIDA -> "FALLIDA";
            case ST_RETIRADA -> "RETIRADA";
            default -> "ST_" + state;
        };
    }

    public static String motiveName(int motive) {
        return switch (motive) {
            case MOT_INICIAL -> "INICIAL";
            case MOT_MIRADA -> "MIRADA";
            case MOT_POLITICA -> "POLITICA";
            case MOT_OCULTA -> "OCULTA";
            case MOT_INACTIVIDAD -> "INACTIVIDAD";
            case MOT_ROL -> "ROL";
            default -> "MOT_" + motive;
        };
    }

    public static String eventName(int event) {
        return switch (event) {
            case OBRA_LISTADO -> "LISTADO";
            case OBRA_ALTA -> "ALTA";
            case OBRA_ESTADO -> "ESTADO";
            case OBRA_EDICION -> "EDICION";
            case OBRA_BAJA -> "BAJA";
            default -> "EVENT_" + event;
        };
    }
}
