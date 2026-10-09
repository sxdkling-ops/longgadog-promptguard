"""Name lists for the detector. A small language model misses plain names more often than expected ("Dear Maria
Santos" among them), so common Filipino and English given names and surnames are also matched directly.

The lists are deliberately ordinary: frequent names typed from general knowledge, not taken from any dataset of
real people. Extend them freely; one lowercase name per entry.
"""
import re

GIVEN = set("""
maria mary jose juan john jon joseph josefa ana anna anne ann angelica angela angelo angelito antonio anthony tony tonyo
andres andrew andrea alberto albert alfredo alfred alex alexander alexandra alexis alicia alice allan alan alvin amado amelia
arnel arnold arturo arthur armando benjamin benjie ben benigno bernard bernardo bea beatrice beatriz bianca carlo carlos carla
carmela carmen carmelita catherine katherine kathleen cecilia cecille cesar charles charlie cherry christine cristina kristine
christopher cristopher kristoffer clarissa claire conrado corazon cynthia daniel daniela danilo dante darwin david dennis diana
diane dolores dominic dominador edgar edgardo eduardo edward edwin elena elizabeth eliza elmer emilio emmanuel manuel manny
enrique erica erika ernesto esperanza estela esther eugenio evelyn fatima felipe felix ferdinand fernando florencio francis
francisco frank gabriel gerald gerardo gilbert gloria gregorio guillermo helen henry hernando ignacio imelda irene isabel
isabella ismael jaime james janet janine jasmin jayson jason jeffrey jennifer jenny jerome jerry jessica jesus jimmy joan
joanna joel joey jocelyn jomar jonathan jordan jorge joshua josephine joy joyce judith julia julian julie julius jun junjun
jun-jun justin karen karl katrina kenneth kevin kim kristina lance larry laura lawrence leah leonardo leo leticia liza lisa
lorenzo lorna lourdes lucia luis luisa luz lydia mae manuel marco marcos marcelo margarita margaret maricel maricar marie
marilou marilyn mario marissa marites marivic marjorie mark marlon martin marvin maryann mateo matthew maureen melanie
melissa mercedes michael michelle miguel mila milagros monica myrna nancy natalia nathaniel nelson nestor nicole noel nora
norma oscar pablo paolo paul paulo patricia patrick pedro perla peter philip pilar rafael ramon randy raul raymond rebecca
regina remedios rene renato reynaldo ricardo richard rico rita robert roberto rodel rodolfo rodrigo roger rolando romeo
rommel ronald ronaldo rosa rosario rose roselyn rosemarie rowena roy ruben rudy ruth ryan salvador samuel sandra sarah
sergio sharon sheila shirley simon sofia sonia stephanie stephen steven susan teresa teresita theresa thomas timothy tomas
tristan valentin vanessa veronica vicente victor victoria vilma vincent virgilio virginia wilfredo william wilson zenaida
""".split())

SURNAMES = set("""
santos reyes cruz bautista ocampo garcia mendoza torres tomas andrada castillo flores villanueva ramos castro rivera aquino
navarro salazar mercado delacruz delarosa delossantos gonzales gonzalez lopez hernandez perez fernandez ramirez domingo
francisco santiago soriano pascual valdez aguilar marquez sanchez morales gutierrez dizon manalo pangilinan panganiban
macaraeg magno magbanua magsaysay lacson lim tan uy go chua sy ong co yap chan lee dy ang cu yu king cabrera vergara
villar villegas alvarez diaz gomez jimenez martinez rodriguez romero rosales samonte santillan tolentino umali velasco
ventura zamora abad agustin alcantara angeles arellano avila bernardo buenaventura cabral calderon cortez de guzman
deguzman deleon delgado enriquez espino espiritu estrada evangelista fajardo ferrer galang gatchalian guevarra ignacio
javier lacsamana legaspi luna macapagal madrigal manuel medina miranda natividad nolasco padilla palma paredes pineda
ponce quiambao quinto robles roque rosario roxas sison suarez tiongson trinidad vasquez velasquez viray yambao zulueta
smith johnson williams brown jones miller davis wilson anderson taylor thomas moore jackson martin thompson white harris
clark lewis robinson walker young allen wright scott hill green adams nelson baker hall campbell mitchell carter roberts
kling candelaria
""".split())

# Words that are also ordinary English or Tagalog words: only counted as a name next to another name.
AMBIGUOUS = set("""
joy rose mark art bill will rich mae may april june august summer dawn jade ruby crystal cherry ivy lily daisy jasmin faith
hope grace angel prince king queen young white brown green hill hall martin thomas manuel de go co sy ang yu tan lee kim luz
rosario francisco domingo angeles luna cruz santos mercado castillo flores torres rivera castro leo noel rico roy
""".split())

PARTICLES = {"de", "dela", "del", "delos", "la", "los", "san", "sta", "santa", "santo", "van", "von"}

# A capitalised name word directly before one of these is a place or an institution, not a person.
PLACE_AFTER = {"city", "street", "st", "ave", "avenue", "blvd", "boulevard", "road", "rd", "drive", "highway", "province", "hall",
               "bridge", "park", "university", "college", "hospital", "institute", "building", "bldg", "tower", "center", "centre",
               "plaza", "mall", "airport", "station", "district", "village", "subdivision", "heights", "bank", "church", "school"}

_TOKEN = re.compile(r"[A-Za-zÑñ][A-Za-zÑñ'’\-]*")


def find_names(text: str) -> list[tuple[int, int]]:
    """Spans that look like personal names, from the lists above."""
    tokens = [(m.group(0), m.start(), m.end()) for m in _TOKEN.finditer(text)]
    spans, i = [], 0
    while i < len(tokens):
        word = tokens[i][0].lower()
        if word not in GIVEN and word not in SURNAMES:
            i += 1
            continue
        j = i
        # extend over neighbouring name words, particles and initials that are separated by a single space
        while (j + 1 < len(tokens) and text[tokens[j][2]:tokens[j + 1][1]] in (" ", ". ")
               and (tokens[j + 1][0].lower() in GIVEN or tokens[j + 1][0].lower() in SURNAMES
                    or tokens[j + 1][0].lower() in PARTICLES or (len(tokens[j + 1][0]) == 1 and tokens[j + 1][0].isupper()))):
            j += 1
        while j > i and (tokens[j][0].lower() in PARTICLES or len(tokens[j][0]) == 1):
            j -= 1
        words = [t[0] for t in tokens[i:j + 1]]
        lower = [w.lower() for w in words]
        names = [w for w in lower if w in GIVEN or w in SURNAMES]
        nxt = tokens[j + 1][0].lower() if j + 1 < len(tokens) and text[tokens[j][2]:tokens[j + 1][1]] == " " else ""
        strong = [w for w in names if w not in AMBIGUOUS]
        capitalised = all(w[0].isupper() for w in words if w.lower() not in PARTICLES)
        if len(names) >= 2 and (strong or capitalised):
            ok = True                                   # "Maria Santos", "jun-jun bautista", "Rose Cruz"
        elif len(names) == 1 and strong and (words[0][0].isupper() or strong[0] in SURNAMES and len(strong[0]) > 3):
            ok = True                                   # "Marco", "Soriano", "bautista"
        else:
            ok = False
        if ok and nxt in PLACE_AFTER:
            ok = False                                  # "Quezon City", "Aquino Avenue"
        if ok:
            spans.append((tokens[i][1], tokens[j][2]))
        i = j + 1
    return spans
