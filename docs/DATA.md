# Real data — mənbələr və metodologiya

Sistem iki real mənbəyə əsaslanır: **opendata.az** (rəsmi dövlət datası, üstünlük bunundur) və **OpenStreetMap + Wikidata** (xəritə həndəsəsi, park və stadion poliqonları, pilləkənlər).

## 1. opendata.az — Azərbaycan Respublikası Açıq Məlumatlar Portalı

İdxal skripti: [`scripts/fetch-opendata-az.mjs`](../scripts/fetch-opendata-az.mjs). Nəticə: [`server/src/data/opendata-az.json`](../server/src/data/opendata-az.json). Portal CKAN əsaslıdır (`https://admin.opendata.az/api/3/action`). Skript hər dataseti adına (slug) görə tapır və onun son resursunu yükləyir. Portal müvəqqəti xəta qaytaranda sorğunu təkrarlayır.

### Analiz
Kataloqdakı **2 071 datasetin hamısı** API ilə çəkildi və açar sözlərə görə qiymətləndirildi: sığınacaq, fövqəladə hal, səhiyyə, əhali, məkanlar, Bakı, koordinat. 183 dataset uyğun çıxdı. Onlardan koordinatı olan, Bakıya aid və prototipə real dəyər verən 7-si seçildi:

| Dataset | Təşkilat | Sistemdə istifadəsi |
|---|---|---|
| Metro çıxışları üzrə koordinatlar (98 çıxış) | Bakı Metropoliteni | 27 işləyən stansiya sığınacaq kimi; piyada **ən yaxın real çıxışa** yönləndirilir |
| Stansiyalar üzrə gündəlik sərnişin sayı (2025) | Bakı Metropoliteni | Metro sığınacaqlarının ilkin doluluğu orta gündəlik yükə mütənasibdir (20–80%) |
| İdman qurğuları və stadionlar | Gənclər və İdman Nazirliyi | Rəsmi obyektlər; mövcud olmayanlar ehtiyat məntəqəyə əlavə olunur |
| Olimpiya İdman Kompleksləri | Gənclər və İdman Nazirliyi | Bakıdakı kompleks ehtiyat məntəqələr |
| Rayonların ərazisi, əhalisi və sıxlığı (2024) | DSK | Zonaların rəsmi əhalisi və sıxlığı (Wikidata 2019 əvəzinə) |
| İnzibati ərazi vahidləri üzrə əlilliyi olan şəxslər | DSK | Zonada xüsusi qayğıya ehtiyacı olanların sayı (Drop 1 ilə əlaqəli) |
| Binaların dağılması və uçması hadisələri (2007–2025) | FHN | Dispetçer panelində tarixi risk qrafiki |

### İstifadə olunmayanlar və səbəbi
- **Tibb müəssisələri** (Səhiyyə Nazirliyi): yalnız ad və e-poçt var, koordinat yoxdur. Əvəzində OSM-dəki 104 xəstəxana istifadə olunur.
- **FHN qurumları və regional mərkəzlər:** yalnız ünvan var, koordinat yoxdur. Prototipdə geokodlaşdırma etibarlı olmadığı üçün daxil edilmədi.
- **Təbii və texnogen hadisələrin statistikası (2024–2025):** ölkə üzrə aqreqatdır, məkan bölgüsü yoxdur.
- Qəbələ, Ağdaş və başqa rayonların datası əməliyyat ərazisindən (Bakı) kənardadır.

### Keyfiyyət tapıntıları
- OSM-də "metro sığınacağı" kimi düşən 7 obyekt (tikilən Y14, Y15, Y16 və 20 Sentyabr stansiyaları, depo, təkrar yazılışlar) rəsmi siyahıda yoxdur və çıxarıldı.
- Mənbə faylında Excel "28 May" adını tarixə çevirib. Skript bunu bərpa edir.
- Rəsmi idman obyektlərinin bir hissəsi Bayıl sahilindədir. Bu, daxili sahil modelinin düzəldilməsinə səbəb oldu (OSM plitələri ilə yoxlanılıb).

**Lisenziya:** dataset metadata-sında göstərildiyi kimi (CC-BY, CC0 və ya "notspecified"). Mənbə linkləri dispetçer panelində göstərilir.

## 2. OpenStreetMap + Wikidata

Sistem Bakı şəhərinin real coğrafi datası üzərində işləyir. İdxal skripti: [`scripts/fetch-osm-data.mjs`](../scripts/fetch-osm-data.mjs). Nəticə faylı: [`server/src/data/baku-osm.json`](../server/src/data/baku-osm.json).

## Mənbələr

| Data | Mənbə | OSM teqi / Wikidata xüsusiyyəti | Say |
|---|---|---|---|
| Metro stansiyaları (sığınacaq) | OpenStreetMap (Overpass API) | `station=subway` | 31 |
| Parklar (açıq toplanış sahəsi) | OpenStreetMap | `leisure=park` + `name`, sahəsi ≥ 2,5 ha | 29 |
| Stadionlar | OpenStreetMap + Wikidata | `leisure=stadium`, tutum: `capacity` və ya Wikidata **P1083** | 7 |
| Yanğınsöndürmə hissələri (briqada bazası) | OpenStreetMap | `amenity=fire_station` | 21 |
| Xəstəxanalar (tibbi briqada bazası, xəritə qatı) | OpenStreetMap | `amenity=hospital` | 104 |
| Rayonlar və əhali | OpenStreetMap + Wikidata | `boundary=administrative`, əhali: Wikidata **P1082** (2019) | 12 |

Sistemə yüklənənlər: **67 toplanış məntəqəsi** (56 açıq, 11 ehtiyat), **26 xilasetmə bölməsi** (10 yanğınsöndürən, 6 xilasetmə, 10 tibbi) və **104 xəstəxana**.

**Lisenziya:** OpenStreetMap © OpenStreetMap contributors, [ODbL](https://opendatacommons.org/licenses/odbl/). Wikidata: CC0. Atribusiya xəritədə və login səhifəsində göstərilir.

## Tutum evristikaları

| Növ | Qayda | Əsaslandırma |
|---|---|---|
| Metro sığınacağı | 1 500 nəfər | Dərin stansiyalar mülki müdafiə obyekti kimi layihələndirilib. Platforma və vestibül sahəsinə görə konservativ qiymətdir |
| Park | sahə × 50% (istifadəyə yararlı) ÷ 2 m²/nəfər, 500 ilə 20 000 arası | Açıq toplanış sahələri üçün geniş yayılmış 2 m²/nəfər normativi. Sahə OSM bounding box × 0,65 ilə təxmin edilir |
| Stadion | oturacaq sayı (OSM/Wikidata), maksimum 30 000. Məlumat yoxdursa 3 000 | Meydança xidmət və tibbi zona üçün saxlanılır, izdiham təhlükəsizliyi üçün üst hədd qoyulub |

## Əlçatanlıq (Drop 1)
- **Məntəqə:** OSM `wheelchair` teqi əsasdır. Teq yoxdursa: park və stadion yerüstü açıq sahə kimi əlçatandır, dərin metro stansiyaları (eskalator və pilləkən, lift datası yoxdur) əlçatan deyil. Nəticədə 67 məntəqədən 38-i əlçatandır.
- **Maneələr:** `highway=steps` və pilləkənli yeraltı piyada keçidləri (`highway=footway` + `tunnel=yes` və ya `layer=-1`), cəmi 761 nöqtə. Əlçatan marşrut bunlardan qaçınır.

## Süzgəclər (təhlükəsizlik və etika)
Hökumət iqamətgahları, xiyabanlar və memorial ərazilər, zoopark və qəbiristanlıqlar toplanış məntəqəsi siyahısından çıxarılır (`EXCLUDE` regex).

## Açıq/ehtiyat bölgüsü
- Açıq: bütün metro sığınacaqları, ən böyük 22 park və tutumu ≥ 10 000 olan stadionlar.
- Ehtiyat: növbəti 8 park və kiçik stadionlar. Bunlar dispetçer qərarı ilə açılır.

## İlkin doluluq
Demo hər dəfə eyni vəziyyətdən başlasın deyə doluluq deterministikdir: məntəqə id-sinin hash-inə görə 20–75%. Mərkəzdəki 2 məntəqəyə əvvəlcədən yüksək yük verilib (Dənizkənarı Milli Park 86%, Sahil 82%).

## Ehtiyat rejim
`DATASET=curated` dəyişəni və ya JSON faylının olmaması halında `seed.ts`-dəki əl ilə hazırlanmış 20 məntəqə və 9 briqada istifadə olunur. Sistem işə düşmək üçün internetdən asılı deyil.

## Yeniləmə
```bash
node scripts/fetch-osm-data.mjs            # yeni data çəkir (keşləyir)
node scripts/fetch-osm-data.mjs --cached   # yalnız emal qaydalarını yenidən tətbiq edir
```
