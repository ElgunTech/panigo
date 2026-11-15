# Challenge Drop-lar — tələb, həll və sübut

## Drop 1 — Hərəkət məhdudiyyətli şəxs (Prioritet SOS) + tam i18n

### Tələb
1. Yeni rol: **"Hərəkət məhdudiyyətli şəxs / Xüsusi qayğıya ehtiyacı olan vətəndaş"**.
2. Bu rolun SOS-u avtomatik **Kritik Prioritet (Priority #1)** almalıdır.
3. Ona yalnız **əlil arabası və tibbi nəqliyyat üçün əlçatan** (panduslu, maneəsiz) təxliyə marşrutu təyin olunmalıdır.
4. Bütün UI Azərbaycan və ingilis dillərində dinamik dəyişdirilə bilməlidir (i18n).

### Həll

| Tələb | Necə həll olunub | Fayl |
|---|---|---|
| Yeni rol | `mobility_impaired` rolu RBAC matrisinə **1 sətir data** kimi əlavə olundu: vətəndaş icazələri + `sos:priority` + `evac:accessible`. Kod rola deyil, icazəyə baxır (`can(role, 'sos:priority')`). | `server/src/security/auth.ts` |
| Rolu necə almaq olar | (a) qeydiyyatda "Hərəkət məhdudiyyətim var" seçimi; (b) qeydiyyatsız "Xüsusi qayğı ilə davam et" (fövqəladə halda hesab tələb olunmur); (c) admin paneldə rol təyini. Öz-özünə qeydiyyat heç vaxt dispetçer/admin yarada bilmir. | `userRepository.ts`, `Login.tsx`, `SidePanel.tsx` |
| Priority #1 | Prioritet **serverdə autentifikasiya olunmuş roldan** təyin olunur, sorğunun body-sindən deyil: saxtalaşdırmaq mümkün deyil (testlə yoxlanılıb). SOS `priority: 1, specialNeeds: true` alır və dərhal `priority_sos` QIRMIZI HƏYƏCAN yaranır. | `engine.ts`, `crisisService.ts`, `api.ts` |
| Dispetçer görünüşü | P1 siqnallar SOS axınında həmişə ən yuxarıdadır, bənövşəyi "♿ P1" nişanı və xəritədə böyük bənövşəyi halqa ilə. Həyəcan kartında "Əlçatan tibbi nəqliyyat göndər" tövsiyəsi (ən yaxın tibbi briqada) var. 1 kliklə icra zamanı yeni toplanış məntəqəsi açılmır, nəqliyyat göndərilir. | `SosFeed.tsx`, `AlertsPanel.tsx`, `CityMap.tsx` |
| Əlçatan məntəqə | Real OSM `wheelchair=yes/limited/no` teqi əsasdır. Teq yoxdursa: park və stadion (yerüstü açıq sahə) əlçatandır, dərin metro (eskalator və pilləkən) əlçatan deyil. 67 məntəqədən **38-i əlçatandır**. | `scripts/fetch-osm-data.mjs`, `recommendation.ts` |
| Maneəsiz marşrut | `RouteProfile = 'accessible'`. OSM-dən real **761 maneə** (`highway=steps` və pilləkənli yeraltı keçidlər) çəkilir. Daxili qrafda maneə yaxınlığındakı kənarlara cərimə tətbiq olunur. OSRM alternativləri arasından ən az maneəlisi seçilir. Plan "pilləkən yoxdur" və ya "N maneə" məlumatı verir. ETA əlil arabası sürəti (0,8 m/s) və tibbi nəqliyyatla hesablanır. | `simulatedProvider.ts`, `routingService.ts` |
| Avtomatik reroute | Yol bağlananda və ya məntəqə ≥90% dolanda yeni marşrut **yenə əlçatan profillə** qurulur (sessiya profili saxlayır). | `evacuationService.ts` |
| Tam i18n | Bütün sabit mətnlər lüğətə keçirildi: GPS mesajları, bağlanma səbəbləri, xəta mesajları, `aria-label`-lar. `<html lang>` dillə sinxrondur (böyük hərf, ekran oxuyucular). Test AZ və EN açarlarının tam üst-üstə düşdüyünü və boş tərcümə olmadığını yoxlayır. | `client/src/i18n/*`, `i18n.test.ts` |

### Sübut (avtomatik testlər)
`server/test/accessibility.test.ts` (10 test) və `client/src/i18n/i18n.test.ts` (3 test):
- Qeydiyyatda rol seçimi, admin tərəfindən təyin, dispetçer hüququnun olmaması
- Bu rolun SOS-u → `priority: 1` + `priority_sos` həyəcanı + tibbi briqada
- Adi vətəndaş body-də `priority: 1` göndərsə də `priority: 2` qalır
- 1 klik icra: nəqliyyat yola düşür, ehtiyat məntəqə açılmır
- Plan yalnız `accessible: true` məntəqələrdən ibarətdir
- Reroute əlçatan profili saxlayır
- Əlçatan marşrut standart marşrutdan çox pilləkən yaxınlığından keçmir (real OSM datası ilə)
- AZ və EN lüğətləri tam və eynidir

---

## Drop 2 — Xarici xəritə/marşrut API-si sıradan çıxıb (HTTP 503 və ya > 5 s)

### Tələb
Xarici API **HTTP 503** qaytaranda və ya **5 saniyədən gec** cavab verəndə:
1. Sistem çökməməlidir (unhandled exception olmamalıdır).
2. Circuit breaker və fallback avtomatik işə düşməlidir.
3. Marşrut və məsafə **lokal ehtiyat bazadan** hesablanmalıdır (statik koordinat matrisi və ya son keşlənmiş marşrutlar).
4. İstifadəçiyə **"Oflayn/Ehtiyat marşrut rejimində işləyir"** bildirişi göstərilməlidir.

### Həll

**Fallback zənciri** (`ROUTING_PROVIDERS=osrm-foot,osrm,cache,simulated,matrix`):

| # | Provayder | Növ | Nə verir |
|---|---|---|---|
| 1 | `osrm-foot` | xarici | Canlı piyada marşrutu |
| 2 | `osrm` | xarici | Canlı yol marşrutu (briqadalar, əlçatan rejim) |
| 3 | `cache` | **lokal**: son keşlənmiş marşrutlar | Xarici API-nin qaytardığı hər marşrut SQLite-a (`route_cache`) yazılır. Kəsintidə vətəndaşa 450 m yaxınlıqda başlayan real küçə həndəsəsi verilir və onun mövqeyinə calanır. Başlanğıcda `offline-routing.json`-dakı 48 real marşrut yüklənir |
| 4 | `simulated` | **lokal**: yol şəbəkəsi modeli | A* qrafı, bağlı yollardan qaçır |
| 5 | `matrix` | **lokal**: statik koordinat matrisi | 77 anker × 154 məntəqə və metro çıxışı üzrə real piyada məsafə və vaxt (OSRM Table API ilə əvvəlcədən hesablanıb) |
| 6 | `straight` | son çarə | Düz xətt × 1,3 təxmini |

| Mexanizm | Detal | Fayl |
|---|---|---|
| Xəta növlərinin tanınması | 503, 502, 504 və 429 → `UpstreamUnavailableError` (`Retry-After` oxunur); 5 s → `UpstreamTimeoutError` (`OSRM_TIMEOUT_MS=5000`) | `osrmProvider.ts` |
| Circuit breaker | 3 ardıcıl xəta → `open`; müddət = max(30 s, `Retry-After`); sonra `half-open` yoxlaması; uğurlu olarsa `closed` | `circuitBreaker.ts` |
| Çökməməyə zəmanət | Hər provayder `try/catch` + 6 s sərt timeout içindədir, `route()` heç vaxt istisna atmır; Express xəta handler-i; prosesdə `unhandledRejection` və `uncaughtException` qoruyucuları | `routingService.ts`, `index.ts` |
| Bərpa | Oflayn cavablar keşlənmir. API qayıdanda vətəndaşın planı avtomatik canlı marşrutla yenilənir | `routingService.ts`, `Citizen.tsx` |
| Bildiriş | `SystemStatus.routingMode = online / offline` vətəndaşlara və dispetçerə canlı göndərilir. Vətəndaş banner, xəritə üzərində "Ehtiyat rejim" nişanı və "Mənbə: Son keşlənmiş real marşrut / Lokal yol şəbəkəsi / Statik matris" görür | `engine.ts`, `Citizen.tsx` |
| Demo (xəta inyeksiyası) | Dispetçer → İdarəetmə → Davamlılıq: **Normal / HTTP 503 / Timeout >5 s / Tam kəsinti**. Xəta həqiqi kod yolundan keçir və breaker öz-özünə açılır. Kartda provayderlərin vəziyyəti, son xəta, yenidən yoxlamaya qalan vaxt və keşdəki marşrut sayı göstərilir | `POST /api/sim/fault`, `SidePanel.tsx` |
| Ehtiyat datanın qurulması | `node scripts/build-offline-routing.mjs`: statik matris və ilkin keş (repoya commit olunur) | `scripts/` |

### Ölçülmüş nəticə (canlı sistem)

| Ssenari | 1-ci sorğu | Sonrakı sorğular | Mənbə |
|---|---|---|---|
| HTTP 503 | HTTP 200, 6 ms | 3 ms | `cache` (real küçə həndəsəsi), `simulated` |
| Timeout >5 s | HTTP 200, 5013 ms (bir dəfə) | **2 ms** (breaker açıqdır) | `simulated` |
| Xəta sıfırlananda | Rejim → `online`, plan canlı marşrutla yenilənir | | `osrm-foot` |

### Sübut (avtomatik testlər): `server/test/offline.test.ts` (8 test)
Testlər əsl HTTP stub serverlə aparılır:
- **503:** lokal fallback işə düşür, `offline: true` qaytarılır, istisna yoxdur.
- **Gecikmə:** timeout-dan gec cavab xəta sayılır.
- **Breaker:** 3 xətadan sonra açılır, `Retry-After: 60`-a hörmət edir və API-yə müraciəti dayandırır.
- **Bərpa:** half-open yoxlamasından sonra breaker bağlanır.
- **Lokal baza:** son keşlənmiş real marşrut vətəndaşın mövqeyinə calanır; SQLite arxivi restartdan sağ çıxır; statik matris canlı marşrut olmadan məsafə verir.
- **End-to-end:** 503 zamanı `/citizen/plan` 200 qaytarır, `/health` → `routingMode: offline`, bərpadan sonra `online`.


## Drop 3 — SOS Flood / Spam hücumu (500+ saxta SOS)

**Tələb:** panika və ya bot hücumu ilə eyni anda 500-dən çox saxta SOS göndərilir.
SOS endpointlərini rate limiting və dublikat filtrasiyası ilə qorumaq (dispetçer paneli bloklanmamalıdır), dispetçerin kritik əməliyyatlarını (briqadanın yönləndirilməsi) JWT/RBAC ilə qorumaq və kütləvi sorğular zamanı orta cavab müddətini 300 ms-dən aşağı saxlamaq.

### Çoxqatlı müdafiə (sorğu bu ardıcıllıqla keçir)

| # | Qat | Nə edir | Fayl |
|---|---|---|---|
| 1 | Qlobal IP limiti | Hər IP üçün bütün `/api`-yə 600 sorğu/dəq | `app.ts` |
| 2 | Qonaq sessiya limiti | Bir IP dəqiqədə ən çox **20** anonim token ala bilər (`GUEST_PER_IP_PER_MIN`). Bot sonsuz sayda "fərqli vətəndaş" yarada bilmir | `api.ts` |
| 3 | SOS / IP limiti | Kimlik dəyişsə də, bir IP-dən dəqiqədə ən çox **30** SOS (`SOS_PER_IP_PER_MIN`) → `429 TOO_MANY_SOS` + `retryAfterSec` | `middleware.ts` (`keyedLimiter`) |
| 4 | SOS / vətəndaş limiti | Bir hesabdan dəqiqədə ən çox **6** SOS | `middleware.ts` |
| 5 | Dublikat filtri | Eyni vətəndaş, eyni təhlükə növü, **2 dəq** və **150 m** daxilində → yeni SOS yaranmır, mövcud SOS `200` + `duplicateOf` ilə qaytarılır. `Idempotency-Key` başlığı şəbəkə təkrarını və iki dəfə toxunmanı həll edir | `sosGuard.ts` |
| 6 | Bot skorlaması → karantin | Zəif siqnalların cəmi ≥ 3 olarsa SOS **karantinə** düşür (aşağıdakı cədvəl) | `sosGuard.ts` |
| 7 | Panelin qorunması | Karantindəki SOS dispetçer lentinə (WebSocket), `/dispatch/snapshot`-a, metrikalara və **böhran alqoritminə düşmür**. Saxta "≥4 fərqli vətəndaş" klasteri qırmızı həyəcan yarada bilmir. SOS silinmir, sadəcə gözləyir | `store.ts`, `crisisEngine.ts`, `engine.ts` |

**Bot skoru** (bir panik içində olan real vətəndaş ən çox 1 bal toplayır və heç vaxt karantinə düşmür):

| Siqnal | Bal |
|---|---|
| Yeni anonim sessiya (token < 20 s əvvəl verilib) | +1 |
| IP partlayışı (60 s-də eyni IP-dən > 5 SOS) | +2 |
| Koordinat barmaq izi (60 s-də ≥ 3 fərqli "vətəndaş" eyni koordinatı 1e-5° dəqiqliyi ilə göndərir; real telefonlar heç vaxt üst-üstə düşmür) | +2 |
| Kütləvi axın (> 200 SOS/dəq) və yeni anonim sessiya | +1 |
| Qeydiyyatlı hesab | −2 |

Göndərənə karantin barədə məlumat verilmir (`201` qaytarılır, bot heç nə öyrənmir). Dispetçer **İdarəetmə → Spam qoruması** kartında karantin siyahısını görür (səbəblər və bal ilə): **"Həqiqidir"** düyməsi SOS-u lentə və böhran alqoritminə buraxır, **"Hamısını rədd et"** spamı ləğv edir. Hər iki əməliyyat audit jurnalına yazılır. Yeni icazə: `sos:moderate` (dispetçer və admin).

### Kritik əməliyyatlar: JWT + RBAC

| Mexanizm | Detal |
|---|---|
| JWT hardening | Yalnız **HS256** (`algorithms: ['HS256']`): `alg: none` və alqoritm dəyişdirmə hücumları rədd edilir. `issuer` (`panigo`) və `audience` (`panigo-api`) yoxlanılır. Bitmiş, başqa açarla imzalanmış və ya payload-u dəyişdirilmiş token → `401` |
| Rol hər sorğuda | Qeydiyyatlı istifadəçinin rolu tokendən yox, hər sorğuda bazadan oxunur. Admin rolu dəyişəndə və ya hesabı bloklayanda dərhal qüvvəyə minir |
| RBAC | `brigade:dispatch` (briqada göndərmə, ən yaxına göndərmə), `alert:decide` (həyəcanın təsdiqi), `closure:manage`, `sos:moderate`. Vətəndaş və hərəkət məhdudiyyətli şəxs rolları → `403` |
| Operator limiti | Hər operator dəqiqədə ən çox **60** kritik əməliyyat (`OPS_PER_OPERATOR_PER_MIN`). Oğurlanmış token ilə briqadaları kütləvi yönləndirmək olmur → `429 TOO_MANY_OPERATIONS` |
| Proksi etibarı | `TRUST_PROXY=loopback`: `X-Forwarded-For` yalnız lokal proksidən (Vite, tunel) qəbul edilir. Vite proksi `xfwd: true` ilə real ünvanı əlavə edir, ona görə saxta XFF ilə IP limitini keçmək olmur |

### Latency < 300 ms

- Hər `/api` cavabı `process.hrtime` ilə ölçülür (`LatencyTracker`). Son 60 s üzrə **orta** və **p95** dispetçer panelində canlı göstərilir və `/api/health`-də verilir.
- Hücum zamanı da sürətli qalmasının səbəbləri: rədd edilən sorğular (429, dublikat) heç bir iş görmədən qaytarılır; karantin SOS-u WebSocket yayımına və böhran hesablamasına düşmür; guard O(1) sürüşən pəncərələrlə işləyir və yaddaşı məhduddur (hər 256 çağırışda təmizlik).

### Ölçülmüş nəticə — `scripts/flood-test.mjs`

Default qoruma parametrləri ilə (limitlər artırılmadan), lokal noutbuk, bütün axınlar **eyni anda**:

| Ssenari | Saxta SOS | Orta latency (klient) | Server daxili orta | Real vətəndaşlar | Dispetçer paneli | Botdan yaranan həyəcan |
|---|---|---|---|---|---|---|
| Bot A (1 IP, 300) + Bot B (300 paylanmış IP, eyni koordinat) + Bot C (100 təkrar) + 40 real + dispetçer | **700** | **24 ms** (p95 72 ms) | 1,3 ms | 40/40 qəbul, 0 karantin | 29 sorğu, 0 xəta, 5 briqada göndərildi | **0** |
| 500 + 2000 + 200 saxta, 100 real | **2 700** | **24 ms** (p95 42 ms) | 0,5 ms | 100/100 qəbul, 0 karantin | 66 sorğu, 0 xəta | **0** |

Guard nəticəsi (2 700 saxta ilə ssenari): 2 025 karantin, 664 sorğu 429 ilə kəsildi, real 100 SOS-un hamısı dispetçer lentində.

```bash
DB_FILE=off npm start
node scripts/flood-test.mjs --url http://localhost:4000
```

Skript real vətəndaşların itmədiyini, karantinə düşmədiyini, panelin xətasız işlədiyini, botların həyəcan yaratmadığını və orta gecikmənin < 300 ms olduğunu yoxlayır. Şərtlərdən biri pozulsa, exit kodu 1 olur.

### Sübut (avtomatik testlər): `server/test/drop3.test.ts` (13 test)
- Qonaq tokeni və SOS üçün IP limitləri; başqa IP-dən real vətəndaş bloklanmır.
- Dublikat (eyni yer və növ) və `Idempotency-Key`.
- 40 paylanmış bot → ≥ 38 karantin, **0 klaster həyəcanı**, lentdə ≤ 2 SOS.
- Karantindən buraxma və "hamısını rədd et"; vətəndaş moderasiya edə bilmir (`403`).
- Ortaq IP-dəki qeydiyyatlı hesab karantinə düşmür.
- `assign`: token yoxdur → `401`, vətəndaş və hərəkət məhdudiyyətli şəxs → `403`, dispetçer → `200`.
- Saxta tokenlər → `401`: `alg: none`, səhv açar, bitmiş, `audience` yoxdur, HS512, payload-da rolun dəyişdirilməsi.
- Operator limiti (`429`), `/health`-də guard və latency statistikası.
