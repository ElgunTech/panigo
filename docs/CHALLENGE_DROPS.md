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
