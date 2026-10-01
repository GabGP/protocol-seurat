package seurat.adapters.in.net.http;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

/** Built-in fallback favicon bytes when disk files are missing. */
final class DefaultFavicon {
    private DefaultFavicon() {}

    static final byte[] SVG = """
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
              <rect width="32" height="32" rx="8" fill="#1A1B21"/>
              <circle cx="16" cy="16" r="3.2" fill="#4355B9"/>
              <circle cx="16" cy="8" r="2" fill="#FF8A5B"/>
              <circle cx="16" cy="24" r="2" fill="#4355B9"/>
              <circle cx="8" cy="16" r="2" fill="#FF8A5B"/>
              <circle cx="24" cy="16" r="2" fill="#B8C4FF"/>
              <circle cx="10.3" cy="10.3" r="2" fill="#B8C4FF"/>
              <circle cx="21.7" cy="21.7" r="2" fill="#FF8A5B"/>
              <circle cx="10.3" cy="21.7" r="2" fill="#4355B9"/>
              <circle cx="21.7" cy="10.3" r="2" fill="#4355B9"/>
            </svg>""".getBytes(StandardCharsets.UTF_8);

    private static final String ICO_B64 =
            "AAABAAIAEBAAAAEAIABBAQAAJgAAACAgAAABACAAwQIAAGcBAACJUE5HDQoaCgAAAA1JSERSAAAA"
            + "EAAAABAIBgAAAB/z/2EAAAEISURBVHheY2AAAmlpFRkpGYVlktKKz6SkFf/jw2A1QLUgPSC9EM3S"
            + "im/RFRKB34INAZmGRZI4DNTLAGQ8xZCA4lMFfmCMLo6En4IMQBFMy+393zP14H9ZeTW4AdIyKv/N"
            + "Xfv+65lnoxvwH8OA7qkH/m/Y/eW/ipoBXExGXvu/Y9AmsCHo6jEMkFfQAGuWllH9r2uWAcYgNsgQ"
            + "aVk1/AYg+xmk0Tl0JxiD2CCxyXPPgDHtDABhkDPBzkXzgqaS6n9FOWUUtVgNAAUUKMBAhsDEQJo/"
            + "t0T835ftRdgAUFSBDAFFnaX7NDCWl1X6vz/H+39noC1WA3AmJJgB6OJI+CnlSZnizERpdgYAgCJx"
            + "ARqs71EAAAAASUVORK5CYIKJUE5HDQoaCgAAAA1JSERSAAAAIAAAACAIBgAAAHN6evQAAAKISURB"
            + "VHhezZfPaxNBFMdz0b9BdpNNsmxb08VUEm2Jv2pjbYqiEdsgVS8KCv44erWCl0g9eLEKHj34A0Up"
            + "elAoePEPENE/wXpPLz0EnvMdnTH7ZtfdVpN14APDm7fvfXfmzexsJsPaDsfzbdu9Z2Xdr5ZdXBfQ"
            + "X7KOWIiJ2DyfbtVqdZuVLd4XD3RDgvwrusiBXIHkvu9vF4OrIQ/0i1Xk1AJ+vTl36i8ip0yOdbH6"
            + "O+1RdGVNyIIzBwcCcmcsq/CFDyTh/P4KrS22JOjz8USI3BnR6RgDCfh2s0W0dE6CPh9PSAcCuDFA"
            + "zhmiy9fv0mL7FU0dXdD2KAFeqUF7Dt+m8sRVUWieEY8TK+DStSV695Ekbz5s0OiumrSHLYFTrFB9"
            + "7i0dab2XlMevGPE4sQJutV9rAWBq+ozho/BKMzo5wExwH06sgPrMWfnmSP7w8Wdy8iOGj8LODtG+"
            + "Y49kcsyENzpr+HBiBQBM+2R9nnL54YDdKY5Jem22WHevNC2Xg8cJI5EATt6tUK3xQE81+rBxvyRE"
            + "CggrMkWtsRxY658ilgM+s8cv0NOV7xL0eXxFpICobeYUdhvJFRhTfk9W1nThos/j//8CUl+CPzGQ"
            + "IuwFWwpbC1ssaDe3YT7nUnNvmSojO404YcQKwGGijlccMjhsuI+i4Lj06UZT1s1Ge4HmJ37XRBSx"
            + "AnCc9q41jlvuozg9PqYLF7y8GO2riBWAD4pKjplQJ9ywf4Imm88l6MOGacebKwHt5gEjHidWAD6p"
            + "+LRiJvCpVfZDJ59pYegr+5yY9hfize+cOkiOqAcjHgMCtnQhiRKwSTpbvpKFLcGmwZUs9Utp6tfy"
            + "1H9M0FL/NUNL9ee0tw369/wHhdXD2g9ThcYAAAAASUVORK5CYII=";

    static final byte[] ICO = Base64.getDecoder().decode(ICO_B64);
}
