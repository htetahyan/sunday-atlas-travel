# CMS fields for localised journey content

Each display string in `content/destinations/*.json` and `content/packages/*.json` is now an object with `en`, `de`, `fr`, `ja`, and `es`. English is required. The other locales are optional. The site uses English when a locale value is missing or empty.

Project owner: paste the two `fields:` blocks below into `public/admin/config.yml`, replacing the `fields:` list of the `destinations` collection and the `fields:` list of the `packages` collection. Leave the rest of that file as it is, including `backend`, `media_folder`, and the collection settings above `fields:`. This task did not edit `config.yml`.

The image field, the destination relation, booleans, and numbers are the same as in the current config. The itinerary list summary reads the English day title (`title.en`), because `title` is now an object. Because `name` is now an object, the relation widget searches and displays `name.en` (`search_fields: [name.en, slug]`, `display_fields: [name.en]`).

## `destinations` `fields:`

```yaml
    fields:
      - label: Slug
        name: slug
        widget: string
        hint: "Lowercase letters, numbers, and hyphens. This becomes the URL segment."
      - label: Name
        name: name
        widget: object
        fields:
          - { label: English, name: en, widget: string, required: true }
          - { label: German, name: de, widget: string, required: false }
          - { label: French, name: fr, widget: string, required: false }
          - { label: Japanese, name: ja, widget: string, required: false }
          - { label: Spanish, name: es, widget: string, required: false }
      - label: Region
        name: region
        widget: object
        fields:
          - { label: English, name: en, widget: string, required: true }
          - { label: German, name: de, widget: string, required: false }
          - { label: French, name: fr, widget: string, required: false }
          - { label: Japanese, name: ja, widget: string, required: false }
          - { label: Spanish, name: es, widget: string, required: false }
      - label: Summary
        name: summary
        widget: object
        fields:
          - { label: English, name: en, widget: text, required: true }
          - { label: German, name: de, widget: text, required: false }
          - { label: French, name: fr, widget: text, required: false }
          - { label: Japanese, name: ja, widget: text, required: false }
          - { label: Spanish, name: es, widget: text, required: false }
      - label: Best seasons
        name: bestSeasons
        widget: object
        hint: "One season per item."
        fields:
          - { label: English, name: en, widget: list, required: true }
          - { label: German, name: de, widget: list, required: false }
          - { label: French, name: fr, widget: list, required: false }
          - { label: Japanese, name: ja, widget: list, required: false }
          - { label: Spanish, name: es, widget: list, required: false }
      - label: Highlights
        name: highlights
        widget: object
        fields:
          - { label: English, name: en, widget: list, required: true }
          - { label: German, name: de, widget: list, required: false }
          - { label: French, name: fr, widget: list, required: false }
          - { label: Japanese, name: ja, widget: list, required: false }
          - { label: Spanish, name: es, widget: list, required: false }
      - label: Visa note
        name: visaNote
        widget: object
        hint: "Must not state specific visa rules."
        fields:
          - label: English
            name: en
            widget: string
            required: true
            default: "Check official government sources before travel"
          - { label: German, name: de, widget: string, required: false }
          - { label: French, name: fr, widget: string, required: false }
          - { label: Japanese, name: ja, widget: string, required: false }
          - { label: Spanish, name: es, widget: string, required: false }
      - label: Hero gradient
        name: heroGradient
        widget: list
        min: 2
        max: 2
        hint: "Exactly two CSS colors, for example #0E4F57 and #1C2430."
      - label: Image
        name: image
        widget: object
        fields:
          - label: Source
            name: src
            widget: image
            media_folder: public/images/destinations
            public_folder: /images/destinations
          - label: Width
            name: width
            widget: number
            value_type: int
            min: 1
          - label: Height
            name: height
            widget: number
            value_type: int
            min: 1
          - label: Alt text
            name: alt
            widget: object
            fields:
              - { label: English, name: en, widget: string }
              - { label: German, name: de, widget: string }
              - { label: French, name: fr, widget: string }
              - { label: Japanese, name: ja, widget: string }
              - { label: Spanish, name: es, widget: string }
      - label: Sample
        name: sample
        widget: boolean
        default: false
        hint: "Show the sample badge."
      - label: Published
        name: published
        widget: boolean
        default: false
        hint: "Off hides this destination from the site."
```

## `packages` `fields:`

```yaml
    fields:
      - label: Slug
        name: slug
        widget: string
        hint: "Lowercase letters, numbers, and hyphens. This becomes the URL segment."
      - label: Title
        name: title
        widget: object
        fields:
          - { label: English, name: en, widget: string, required: true }
          - { label: German, name: de, widget: string, required: false }
          - { label: French, name: fr, widget: string, required: false }
          - { label: Japanese, name: ja, widget: string, required: false }
          - { label: Spanish, name: es, widget: string, required: false }
      - label: Destination
        name: destination
        widget: relation
        collection: destinations
        value_field: slug
        search_fields: [name.en, slug]
        display_fields: [name.en]
        hint: "Destination slug. The package is listed on that destination page."
      - label: Duration (days)
        name: durationDays
        widget: number
        value_type: int
        min: 1
      - label: Style
        name: style
        widget: object
        fields:
          - { label: English, name: en, widget: string, required: true }
          - { label: German, name: de, widget: string, required: false }
          - { label: French, name: fr, widget: string, required: false }
          - { label: Japanese, name: ja, widget: string, required: false }
          - { label: Spanish, name: es, widget: string, required: false }
      - label: Summary
        name: summary
        widget: object
        fields:
          - { label: English, name: en, widget: text, required: true }
          - { label: German, name: de, widget: text, required: false }
          - { label: French, name: fr, widget: text, required: false }
          - { label: Japanese, name: ja, widget: text, required: false }
          - { label: Spanish, name: es, widget: text, required: false }
      - label: Itinerary
        name: itinerary
        widget: list
        summary: "Day {{fields.day}}: {{fields.title.en}}"
        fields:
          - label: Day
            name: day
            widget: number
            value_type: int
            min: 1
          - label: Title
            name: title
            widget: object
            fields:
              - { label: English, name: en, widget: string, required: true }
              - { label: German, name: de, widget: string, required: false }
              - { label: French, name: fr, widget: string, required: false }
              - { label: Japanese, name: ja, widget: string, required: false }
              - { label: Spanish, name: es, widget: string, required: false }
          - label: Description
            name: description
            widget: object
            fields:
              - { label: English, name: en, widget: text, required: true }
              - { label: German, name: de, widget: text, required: false }
              - { label: French, name: fr, widget: text, required: false }
              - { label: Japanese, name: ja, widget: text, required: false }
              - { label: Spanish, name: es, widget: text, required: false }
      - label: Included
        name: included
        widget: object
        fields:
          - { label: English, name: en, widget: list, required: true }
          - { label: German, name: de, widget: list, required: false }
          - { label: French, name: fr, widget: list, required: false }
          - { label: Japanese, name: ja, widget: list, required: false }
          - { label: Spanish, name: es, widget: list, required: false }
      - label: Not included
        name: notIncluded
        widget: object
        fields:
          - { label: English, name: en, widget: list, required: true }
          - { label: German, name: de, widget: list, required: false }
          - { label: French, name: fr, widget: list, required: false }
          - { label: Japanese, name: ja, widget: list, required: false }
          - { label: Spanish, name: es, widget: list, required: false }
      - label: Price from
        name: priceFrom
        widget: number
        value_type: float
        required: false
        default: null
        hint: "Leave empty for on request."
      - label: Currency
        name: currency
        widget: string
        required: false
        hint: "ISO 4217 code, for example USD. Leave empty when the price is on request."
      - label: Price note
        name: priceNote
        widget: object
        fields:
          - label: English
            name: en
            widget: string
            required: true
            default: "Price on request — we quote every trip personally"
          - { label: German, name: de, widget: string, required: false }
          - { label: French, name: fr, widget: string, required: false }
          - { label: Japanese, name: ja, widget: string, required: false }
          - { label: Spanish, name: es, widget: string, required: false }
      - label: Image
        name: image
        widget: object
        fields:
          - label: Source
            name: src
            widget: image
            media_folder: public/images/packages
            public_folder: /images/packages
          - label: Width
            name: width
            widget: number
            value_type: int
            min: 1
          - label: Height
            name: height
            widget: number
            value_type: int
            min: 1
          - label: Alt text
            name: alt
            widget: object
            fields:
              - { label: English, name: en, widget: string }
              - { label: German, name: de, widget: string }
              - { label: French, name: fr, widget: string }
              - { label: Japanese, name: ja, widget: string }
              - { label: Spanish, name: es, widget: string }
      - label: Sample
        name: sample
        widget: boolean
        default: false
      - label: Published
        name: published
        widget: boolean
        default: false
        hint: "Off hides this package from the site."
```
