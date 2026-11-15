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
