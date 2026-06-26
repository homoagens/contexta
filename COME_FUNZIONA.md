# Come funziona Contexta — Guida all'architettura e alle chiamate LLM

Questo documento spiega come è costruito Contexta dall'interno, con focus sulle chiamate al modello linguistico. L'obiettivo è capire il pattern per poter costruire un agente AI da zero.

---

## 1. Visione d'insieme

Contexta è un'applicazione web composta da tre strati:

```
Browser (React/TypeScript)
        ↕ HTTP/JSON
Agent Python (FastAPI)        ← il "cervello"
        ↕ HTTP/JSON
Backend LLM (locale o API)    ← il modello
```

Il browser fa richieste REST all'agent. L'agent costruisce i prompt, chiama il modello, valida la risposta e la restituisce al browser. Il backend LLM è un server separato (locale con gemma3-12b, oppure Anthropic/OpenAI).

---

## 2. Il ciclo di una richiesta di traduzione

Quando l'utente seleziona una parola e preme "Traduci", succede questo:

```
Browser
  → POST /translate  { selected_span: "manifest", target_sentence: "...", ... }

server.py (FastAPI)
  → agent.run("translate", data)

Agent
  → TranslateSkill.run(input, client)

TranslateSkill
  1. client.lookup("manifest")          → dizionario deterministico (WordNet)
  2. build_translate_messages(...)      → costruisce [system, user] per il modello
  3. client.llm(messages, ...)         → chiama il backend LLM
  4. parse_json_object(response)        → estrae il JSON dalla risposta
  5. has_hallucinated_word(best_result) → controlla allucinazioni
  6. → TranslateOutput                  → dizionario JSON al browser
```

---

## 3. La struttura dei messaggi per il modello

Ogni chiamata al modello usa il formato **chat**: una lista di messaggi con ruoli `system` e `user`. È lo stesso formato di ChatGPT/Claude.

```python
messages = [
    {
        "role": "system",
        "content": "You are an English->Italian translator. Output ONLY a raw JSON object..."
    },
    {
        "role": "user",
        "content": '{"span": "manifest", "sentence": "Time is manifest in...", "ctx_before": "..."}'
    }
]
```

**Il system prompt** definisce:
- Il compito del modello (traduttore, sinonimario, assistente)
- Il formato esatto della risposta (JSON con campi precisi)
- Le regole da rispettare (1-3 parole, niente frasi inventate, ecc.)

**Il user message** contiene i dati concreti della richiesta in JSON.

Il modello risponde con un JSON grezzo:
```json
{"best_result": "manifesto", "span_role": "ADJ", "span_sense": "evidente, visibile", "alt": ["palese"], "sentence": "Il tempo è manifesto in..."}
```

---

## 4. Il client LLM — astrazione multi-provider

`agent/tools/client.py` è il punto di contatto con il modello. Espone un unico metodo `llm()` che nasconde qual è il provider reale:

```python
async def llm(
    self,
    messages: list[dict],     # lista di {role, content}
    temperature: float = 0.1, # creatività (0=deterministico, 1=casuale)
    top_p: float = 0.9,       # nucleus sampling
    max_tokens: int = 2048,   # limite lunghezza risposta
    json_mode: bool = False,   # forza risposta JSON (se supportato)
    model_override: str = "",  # override modello per questa richiesta
) -> str:                      # restituisce il testo della risposta
```

Internamente smista verso tre implementazioni:

### Backend locale (default)
```python
# POST al proprio server LLM (gemma3-12b, ecc.)
payload = {
    "messages": messages,
    "temperature": 0.1,
    "model": "gemma3-12b",
    "json_mode": True,
}
r = await httpx.post("http://127.0.0.1:8787/llm", json=payload)
return r.json()["text"]
```

### Anthropic (Claude)
```python
import anthropic
client = anthropic.AsyncAnthropic(api_key="sk-ant-...")
r = await client.messages.create(
    model="claude-haiku-4-5-20251001",
    max_tokens=2048,
    system="You are a translator...",
    messages=[{"role": "user", "content": "..."}],
)
return r.content[0].text
```

### OpenAI
```python
import openai
client = openai.AsyncOpenAI(api_key="sk-...")
r = await client.chat.completions.create(
    model="gpt-4o",
    messages=messages,
    response_format={"type": "json_object"},  # json_mode
)
return r.choices[0].message.content
```

Il codice dell'agente è identico per tutti e tre — cambia solo il `.env`.

---

## 5. La skill — dove sta la logica

Una **skill** è una classe Python che:
1. Riceve un input tipizzato
2. Costruisce il prompt
3. Chiama il modello (con retry se fallisce)
4. Valida e struttura la risposta
5. Restituisce un output tipizzato

```python
class TranslateSkill:
    async def run(self, inp: TranslateInput, client: BackendClient) -> TranslateOutput:

        # 1. Cerca suggerimenti nel dizionario deterministico
        hints = await self._fetch_hints(client, inp.selected_span, ...)

        # 2. Costruisce i messaggi per il modello
        messages = build_translate_messages_with_hints(payload, hints, ...)

        # 3. Loop di retry
        for attempt in range(1, self.max_retries + 1):
            text = await client.llm(
                messages,
                temperature=0.1 + 0.05 * (attempt - 1),  # temperatura crescente
                json_mode=True,
                max_tokens=2048,
            )

            # 4. Parse + validazione
            out = self._parse_and_validate(text, inp)
            return out  # se valido, esce subito

            # se fallisce → prossimo tentativo con prompt diverso
```

### Il retry adattivo

Se il modello risponde male (JSON malformato, campo mancante, allucinazione), la skill non si arrende: cambia strategia al retry:

- **Primo fallimento**: prompt identico ma temperatura +0.05
- **Risposta vuota**: switch a prompt minimalista (più semplice)
- **Risposta con errori**: aggiunge hint dal dizionario per ancorare il modello

---

## 6. Parse e validazione

Il modello restituisce testo grezzo. Bisogna estrarne il JSON:

```python
# parse_json_object trova e parsa il primo oggetto JSON nel testo
# (utile perché alcuni modelli aggiungono testo prima o dopo il JSON)
obj = parse_json_object(text)

# Estrae i campi con fallback su nomi alternativi
# (modelli diversi usano nomi leggermente diversi)
best_result = (
    obj.get("best_result") or
    obj.get("best_span_it") or
    obj.get("translation") or
    obj.get("result") or ""
)

# Controllo allucinazioni: se la parola non esiste nel dizionario
# italiano E contiene cluster consonantici impossibili → retry
if has_hallucinated_word(best_result, target_lang="it"):
    raise ValueError(f"Allucinazione: '{best_result}'")
```

---

## 7. L'Agent — il router

`agent.py` è semplicissimo: tiene un registro di skill e smista le richieste:

```python
class Agent:
    def __init__(self):
        self.client = BackendClient(...)
        self._skills = {
            "translate": TranslateSkill(),
            "chat":      ChatSkill(),
        }

    async def run(self, skill_name: str, input_data: dict) -> dict:
        skill = self._skills[skill_name]
        inp = TranslateInput(**input_data)        # validazione input
        out = await skill.run(inp, self.client)   # esecuzione
        return out.to_legacy_dict()               # dizionario per JSON
```

---

## 8. Il server HTTP — collante tra web e agent

`server.py` è FastAPI. Ogni endpoint è sottile: riceve la richiesta, chiama l'agent, restituisce il risultato:

```python
@app.post("/translate")
async def translate(req: TranslateRequest, user: str = Depends(require_auth)):
    result = await agent.run("translate", req.model_dump())
    return ORJSONResponse(result)
```

Il server non contiene logica di business — tutta nella skill.

---

## 9. Come costruire un agente da zero

Il pattern di Contexta applicato a qualsiasi dominio:

### Passo 1 — Definisci il compito con un system prompt chiaro

```python
system = """
Sei un estrattore di dati. Ricevi un testo e restituisci SOLO un JSON:
{"nome": "...", "data": "YYYY-MM-DD", "importo": 0.0}
Regole:
- Se non trovi un campo, usa null.
- Non aggiungere spiegazioni.
"""
```

### Passo 2 — Costruisci i messaggi e chiama il modello

```python
import httpx

async def call_llm(text: str) -> str:
    messages = [
        {"role": "system", "content": system},
        {"role": "user",   "content": text},
    ]
    r = await httpx.AsyncClient().post(
        "http://127.0.0.1:8787/llm",
        json={"messages": messages, "temperature": 0.1, "json_mode": True}
    )
    return r.json()["text"]
```

### Passo 3 — Parsa e valida la risposta

```python
import json, re

def parse_json(text: str) -> dict:
    # Trova il primo oggetto JSON nel testo
    match = re.search(r'\{.*\}', text, re.DOTALL)
    if not match:
        raise ValueError("No JSON in response")
    return json.loads(match.group())

result = parse_json(await call_llm(documento))
```

### Passo 4 — Aggiungi retry se fallisce

```python
for attempt in range(3):
    try:
        text = await call_llm(documento)
        result = parse_json(text)
        if not result.get("nome"):
            raise ValueError("Campo 'nome' mancante")
        return result
    except Exception as e:
        if attempt == 2:
            raise
        # Al secondo tentativo: prompt più semplice o temperatura più alta
```

### Passo 5 — Esponi via FastAPI

```python
from fastapi import FastAPI
app = FastAPI()

@app.post("/estrai")
async def estrai(body: dict):
    return await run_with_retry(body["testo"])
```

---

## 10. Parametri del modello — cosa fanno

| Parametro | Valore tipico | Effetto |
|-----------|--------------|---------|
| `temperature` | 0.0–0.2 | Risposta deterministica, ideale per JSON e dati strutturati |
| `temperature` | 0.4–0.7 | Risposta creativa, buona per testo libero e chat |
| `top_p` | 0.9 | Nucleus sampling — lascia quasi sempre il default |
| `max_tokens` | 512–2048 | Limite caratteri risposta. Per JSON brevi: 512 basta |
| `json_mode` | True | Il modello è forzato a rispondere con JSON valido (se supportato) |

---

## 11. Errori comuni da evitare

**1. System prompt ambiguo**
Se il prompt usa la parola "span" come placeholder ma il modello la legge letteralmente → risponde con "span" invece del valore reale. Sii esplicito: "traduci il valore nel campo 'span' del JSON".

**2. Fidarsi sempre del JSON**
I modelli locali spesso aggiungono testo prima o dopo il JSON, o omettono campi. Usa sempre un parser robusto con fallback.

**3. Temperatura troppo alta per dati strutturati**
Con `temperature=0.8` un modello può inventare nomi di campo o valori. Per estrazioni e traduzioni: `temperature ≤ 0.2`.

**4. Nessun retry**
Un modello può fallire al primo tentativo per molte ragioni. Tre tentativi con temperatura crescente risolvono il 90% dei casi.

**5. Prompt troppo lungo**
Ogni token in input riduce i token disponibili per la risposta e rallenta il modello. Taglia il contesto al minimo necessario.
