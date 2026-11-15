# Süni intellektdən istifadə haqqında bəyannamə

> Bu sənəd layihədə süni intellekt alətlərindən **harada, necə və hansı nəzarətlə** istifadə olunduğunu göstərir. Hər üzvün süni intellekt nəticələrini hansı sahədə yoxladığı bölmə 4-dədir.

## 1. İstifadə olunan alətlər

| Alət | Versiya / model | Təyinat |
|---|---|---|
| **Claude Code** (Anthropic, Claude desktop tətbiqi) | Claude Opus 5.5 | Arxitektura təklifi, kod yazılması, testlər, data idxalı skripti, brauzerdə yoxlama, sənədlər |
| Claude Code daxili brauzeri | — | Hazır UI-nin real brauzerdə yoxlanması (ekran görüntüləri, klik ssenariləri) |

Başqa generativ alət istifadə olunmayıb. Xəritə datası süni intellekt tərəfindən **uydurulmayıb**: OpenStreetMap və Wikidata-dan skriptlə çəkilib (bax [DATA.md](DATA.md)).

## 2. Mərhələlər üzrə istifadə

| Mərhələ | Süni intellektin rolu | İnsan nəzarəti / qərarı |
|---|---|---|
| Tələblərin təhlili | Tapşırıq mətni modullara və qəbul meyarlarına bölündü (90%, 95%, 500 m, 5 dəq, ≥4 fərqli vətəndaş) | Komanda tapşırığı verdi, prioritetləri və "peşəkar React" tələbini müəyyən etdi |
| Arxitektura seçimi | Hexagonal quruluş, provider chain + circuit breaker, event bus + batch broadcast, RBAC matrisi təklif edildi. Drop-lar üçün genişlənmə nöqtələri əvvəlcədən qoyuldu | Stack (React, Node) və real data tələbi komandanındır |
| Kod yazılması | Backend (domen, servislər, API, təhlükəsizlik) və frontend (vətəndaş, dispetçer, login, admin) kodu yaradıldı | Kod TypeScript strict rejimində tip yoxlamasından keçdi, testlərlə və brauzerdə yoxlandı |
| Testlər | 112 avtomatik test yazıldı: alqoritm, marşrutlaşdırma və fallback, API inteqrasiya, təhlükəsizlik, istifadəçi idarəetməsi, reducer | Testlər işlədildi, hamısı keçir. Bir uğursuz test (səhv test datası) aşkarlanıb düzəldildi |
| Real data | Overpass və Wikidata idxal skripti, tutum evristikaları, uyğunsuz obyektlərin süzgəci yazıldı | Real data istifadəsi komandanın qərarıdır. Nəticə əl ilə yoxlandı |
| Drop 1 (xüsusi qayğı rolu + i18n) | Rol, Prioritet #1, əlçatan profil, OSM əlçatanlıq datası, i18n auditi və 13 test təklif edilib yazıldı | Brauzerdə yoxlandı: qayğı rejimi, P1 SOS, dispetçer kartı, AZ↔EN keçidi |
| opendata.az analizi və piyada marşrutu | 2 071 datasetin CKAN API ilə analizi, 7 datasetin seçilməsi və idxalı, keyfiyyət problemlərinin (Excel tarixi, tikilən stansiyalar, sahil) aşkarlanması, piyada (OSRM-foot) profili | Seçilən datasetlər və nəticələr brauzerdə və testlərlə yoxlandı |
| Drop 2 (xarici API kəsintisi) | Xəta normalizasiyası (503 / timeout), Retry-After, SQLite marşrut arxivi, statik matris skripti, xəta inyeksiyası, oflayn bildirişi və 8 test (stub HTTP server ilə) | Canlı sistemdə 503 və timeout ssenariləri ölçüldü; sistem çökmədi |
| Kamera ilə nəbz (PPG) | Tibbi məhdudiyyətlərin izahı (kamera ilə təzyiq ölçmək etibarlı deyil), PPG alqoritmi, sintetik siqnal testləri, UI və server inteqrasiyası | Komanda yalnız nəbz variantını seçdi. Ölçmə brauzerdə süni kamera axını ilə (75 bpm) uçdan-uca yoxlandı və ~75 bpm nəticə alındı. Real telefonda yoxlama komandaya qalır |
| Challenge drop-lar | Hər drop üçün mövcud mexanizm və dəyişiklik nöqtəsi sənədləşdirildi ([ARCHITECTURE.md §4](ARCHITECTURE.md)) | Drop elan olunanda həll komanda tərəfindən təsdiqlənir |
| Yük testi | `scripts/loadtest.mjs` yazıldı və işlədildi | Rəqəmlər real ölçmədir, uydurulmayıb |
| Sənədlər | README, arxitektura, data və bu bəyannamə yazıldı, Word sənədi hazırlandı | Komanda oxuyub təsdiqləyir |

## 3. Nəzarət mexanizmləri

1. **Avtomatik yoxlama:** hər mərhələdən sonra `tsc --noEmit` (strict) və `vitest`. Commit-lər yalnız yaşıl testlərlə edilib.
2. **Real brauzerdə yoxlama:** vətəndaş marşrutu, 92% doluluqda avtomatik reroute, zəlzələ ssenarisi, qırmızı həyəcan, 1 klik icra, qeydiyyat, admin rol paneli ekran görüntüləri ilə yoxlanıb.
3. **Süni intellektin səhvləri və necə aşkarlandığı** (şəffaflıq üçün):

   | Problem | Necə aşkarlandı | Həll |
   |---|---|---|
   | CARTO xəritə plitələri API açarı tələb edirdi | Brauzerdə "API KEY REQUIRED" görüntüsü | OpenStreetMap plitələri + `VITE_TILE_URL` konfiqurasiyası |
   | Həyəcan icra edildikdən dərhal sonra eyni həyəcan təkrar yaranırdı | Brauzerdə ssenari testi | Yalnız cavabsız (`new`) SOS-lar sayılır + reqressiya testi |
   | OSM yollarında `center` yox idi, parklar itirdi | İdxal statistikasında 0 park | Mərkəz `bounds`-dan hesablanır |
   | Prezident iqamətgahı və xiyaban toplanış məntəqəsi kimi düşmüşdü | Datanın əl ilə yoxlanması | `EXCLUDE` süzgəci + test |
   | Telefon regex-ində escape xətası | Server işə düşmədi (log) | Düzəldildi, tip yoxlaması və testlər təkrarlandı |

4. **Təhlükəsizlik:** sirr və şifrələr kodda yalnız demo default kimi var, productionda env məcburidir. Süni intellektə heç bir real şəxsi data verilməyib.

## 4. Komanda

| Üzv | Rol | Süni intellekt nəticələrini yoxladığı sahə |
|---|---|---|
| **Şükürov Elgün Ramin oğlu** | Full-Stack Developer, AI/ML Engineer (Kaggle) | Arxitektura qərarları, backend və frontend kodunun yoxlanması, marşrutlaşdırma və böhran alqoritmi, real data inteqrasiyası (OSM, opendata.az), kamera ilə nəbz (PPG) alqoritmi, challenge drop həlləri |
| **Məlikova Fatimə Xəyal qızı** | QA, Testing and AI Documentation | Avtomatik testlərin və test ssenarilərinin yoxlanması, brauzer və telefonda manual test, demo ssenarisi, sənədlərin (README, arxitektura, Word) və bu AI bəyannaməsinin dəqiqliyi |
| **Mehdiyev İsgəndər Azər oğlu** | Security | Autentifikasiya və RBAC (JWT, scrypt, rol eskalasiyasının qarşısı), giriş validasiyası, rate limiting, prioritet saxtalaşdırmasının qarşısı, audit jurnalı, xəta inyeksiyası və davamlılıq (Drop 2) |
