# Real data — mənbələr və metodologiya

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
