<p align="center"><img src="client/public/logo-wordmark.svg" alt="PaniGo" width="320"></p>

# PaniGo — Urban Crisis & Crowd Evacuation Engine

Zəlzələ, sel, sənaye qəzası və kütləvi tədbirlər zamanı **vətəndaşları ən yaxın təhlükəsiz toplanış məntəqəsinə yönləndirən**, **SOS siqnallarını toplayan** və **FHN dispetçerlərinə böhran ocaqlarını avtomatik göstərən** real-time mikro-sistem.

> Digital Challenge Cup — Final layihəsi. Data: Bakı şəhəri — **opendata.az** (Bakı Metropoliteni, DSK, FHN, Gənclər və İdman Nazirliyi) + OpenStreetMap + Wikidata.

| Modul | Nə edir |
|---|---|
| **1. Vətəndaş tətbiqi** (`/citizen`) | Rayon / GPS / xəritə üzrə yer seçimi · ən yaxın məntəqələr və onların canlı doluluğu · **piyada** təxliyə marşrutu (səki və piyada keçidləri, OSRM-foot), metro sığınacağının **ən yaxın real çıxışına** qədər · **bir kliklə SOS** (yanğın, dağıntı, su basması, tibbi yardım), siqnalın yeri xəritədə xüsusi nişanla, təyin olunan **briqada canlı** (məsafə, ETA), briqada **100 m**-ə çatanda **"Briqada çatdı"** düyməsi aktivləşir (server də yoxlayır) · **"TƏHLÜKƏSİZƏM"** statusu · yol bağlananda və ya məntəqə **≥90%** dolanda **avtomatik alternativ marşrut** |
| **2. Dispetçer mərkəzi** (`/dispatch`) | Zonalar üzrə canlı SOS axını · məntəqələrin doluluğu · briqadaların statusu və hərəkəti · **Kritik böhran alqoritmi** (500 m və ya eyni zona, 5 dəq, ≥4 fərqli vətəndaş, **və ya** doluluq >95%) → **QIRMIZI HƏYƏCAN** → **1 kliklə təsdiq** (əlavə briqada göndərilir və yeni toplanış nöqtəsi açılır) |
| **Xüsusi qayğı (Drop 1)** | Hərəkət məhdudiyyətli şəxs rolu: SOS avtomatik **Prioritet #1**, yalnız əlçatan (panduslu, pilləkənsiz) məntəqə və marşrut, real OSM pilləkənlərindən qaçınma |
| **Giriş və rollar** (`/login`) | Vahid giriş və qeydiyyat · rollar: vətəndaş / hərəkət məhdudiyyətli / dispetçer / admin · admin istifadəçilərin rolunu dəyişir və onları bloklayır · təcili SOS üçün qeydiyyatsız **qonaq rejimi** |

---

## 1. Lokal işə salma

**Tələblər:** Node.js **≥ 22.13** (tövsiyə: 24 LTS). Node-a daxil olan SQLite istifadə olunur, ayrıca verilənlər bazası lazım deyil.

```bash
npm install
```

```bash
npm run dev
```

- Frontend: <http://localhost:5173>
- API və WebSocket: <http://localhost:4000> (Vite `/api` və `/socket.io` sorğularını bura yönləndirir)

| Hesab | İstifadəçi adı | Şifrə |
|---|---|---|
| Admin | `admin` | `admin123` |
| Dispetçer | `dispatcher` | `dispatcher123` |
| Vətəndaş | `/login` səhifəsində **Qeydiyyat** və ya **Qeydiyyatsız davam et** | — |

> Production-da `JWT_SECRET`, `ADMIN_PASSWORD` və `DISPATCHER_PASSWORD` mütləq dəyişdirilməlidir. Bütün parametrlər [.env.example](.env.example) faylındadır.

### Docker (tək konteyner)

```bash
docker compose up --build
```

Sonra <http://localhost:4000> ünvanını açın. SPA, API və WebSocket eyni portdan verilir, SQLite faylı `panigo-data` volume-da saxlanılır.

### Testlər və keyfiyyət yoxlaması

```bash
npm test
```

```bash
npm run typecheck
```

```bash
node scripts/loadtest.mjs --url http://localhost:4000 --citizens 2000 --concurrency 200
```

Yük testindən əvvəl serveri `RATE_LIMIT_PER_MIN=1000000 AUTH_RATE_LIMIT_PER_MIN=1000000` ilə işə salın, əks halda rate limiter sorğuları kəsəcək.

### Real datanın yenilənməsi (OpenStreetMap + Wikidata)

```bash
node scripts/fetch-osm-data.mjs
```

Nəticə `server/src/data/baku-osm.json` faylına yazılır və repoya commit olunur. Ona görə demo internetsiz də işləyir. Ətraflı: [docs/DATA.md](docs/DATA.md).

### Problem həlli
- **`Cannot find module @rollup/rollup-win32-x64-msvc`**: npm-in optional dependency xətasıdır. `npm i -D @rollup/rollup-win32-x64-msvc` əmrini işlədin.
- **Xəritə plitələri görünmür**: OSM tile serverinə çıxış yoxdur. `VITE_TILE_URL` ilə öz tile serverinizi göstərin. Marşrutlaşdırma bundan asılı deyil, daxili qraf işləməyə davam edir.

---

## 2. Demo ssenarisi (5 dəqiqə)

1. `/login` səhifəsində **admin** kimi daxil olun və **İdarəetmə → Zəlzələ ssenarisi** düyməsini basın. 35 saniyə ərzində SOS dalğası gəlir, yollar bağlanır, məntəqələr dolur.
2. **QIRMIZI HƏYƏCAN** kartı çıxır. Tövsiyəyə baxın (hansı briqada, hansı ehtiyat məntəqə) və **Təsdiqlə (1 klik)** basın. Briqada xəritədə hərəkət edir, ehtiyat məntəqə açılır, audit jurnalına yazılır.
3. Başqa pəncərədə `/citizen` açın. Tövsiyə olunan məntəqəni dispetçer panelində sürüşdürücü ilə **92%**-ə qaldırın. Vətəndaş dərhal **"Məntəqə 92% doldu — alternativ məntəqəyə yönləndirildiniz"** banneri ilə yeni marşrut alır.
4. **Yol bağla → Neftçilər prospekti**: marşrutu bu yoldan keçən vətəndaşlar avtomatik başqa marşruta keçirilir.
5. **Davamlılıq → Xarici xəritə API kəsintisi** açarını yandırın. Sistem OSRM-dən daxili yol qrafına keçir və vətəndaş "daxili marşrut mühərriki" xəbərdarlığını görür.
6. Vətəndaş SOS göndərsin, dispetçer SOS axınında **Təyin et** ilə briqada seçsin. Vətəndaşın xəritəsində SOS nişanı və yaxınlaşan briqada görünür, 100 m-də **"Briqada çatdı"** aktivləşir və dispetçerdə "Vətəndaş təsdiqlədi" nişanı çıxır.
7. **İstifadəçilər** tabında yeni qeydiyyatdan keçən vətəndaşı **Dispetçer** roluna keçirin. Hüquq dərhal qüvvəyə minir, yenidən giriş lazım deyil.

---

## 3. Sənədlər

| Sənəd | Məzmun |
|---|---|
| [docs/CHALLENGE_DROPS.md](docs/CHALLENGE_DROPS.md) | **Challenge Drop 1:** hərəkət məhdudiyyətli şəxs rolu, Prioritet #1 SOS, əlçatan marşrut, tam i18n |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Arxitektura sxemi (frontend → backend → DB/API axını), modullar, alqoritmlər, challenge drop-lara uyğunlaşma |
| [docs/DATA.md](docs/DATA.md) | Real data mənbələri, lisenziya, tutum evristikaları |
| [docs/AI_DECLARATION.md](docs/AI_DECLARATION.md) | Süni intellekt alətlərindən istifadə haqqında bəyannamə |
| [docs/UCE_Texniki_Izah.docx](docs/UCE_Texniki_Izah.docx) | Texniki izah sənədi (Word) |

## 4. Texnologiyalar

React 18 + TypeScript + Vite + Tailwind + Leaflet · Node.js + Express + Socket.IO + Zod · SQLite (`node:sqlite`) · OSRM (xarici marşrut API) + daxili A* yol qrafı · JWT + scrypt + Helmet + rate limiting · Vitest + Supertest (79 test).
