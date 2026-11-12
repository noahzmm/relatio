// Notationen, Kardinalitäts-Beschriftungen und Beispieldiagramme
(function () {
  const R = (window.R = window.R || {});

  R.NOTATIONS = {
    chen: {
      id: 'chen',
      name: 'Chen',
      family: 'chen',
      color: 'orange',
      short: 'Klassisch',
      desc: 'Rechtecke für Entitäten, Rauten für Beziehungen und Ellipsen für Attribute. Kardinalitäten als 1, N und M.',
    },
    minmax: {
      id: 'minmax',
      name: '(min,max)',
      family: 'chen',
      color: 'purple',
      short: 'ISO',
      desc: 'Wie Chen, aber jede Kante trägt ein Intervall (min,max) – wie oft die Entität an der Beziehung teilnimmt.',
    },
    crow: {
      id: 'crow',
      name: "Crow's Foot",
      family: 'box',
      color: 'green',
      short: 'Martin',
      desc: 'Entitäten als Tabellen mit Attributliste, Krähenfüße und Striche zeigen die Kardinalität. Standard in der Praxis.',
    },
    uml: {
      id: 'uml',
      name: 'UML',
      family: 'box',
      color: 'blue',
      short: 'Klassendiagramm',
      desc: 'Entitäten als Klassen mit Attributen, Multiplizitäten wie 1, 0..1 oder 0..* an den Assoziationsenden.',
    },
  };
  R.NOTATION_ORDER = ['chen', 'minmax', 'crow', 'uml'];

  // Kardinalität eines Endes = "wie viele Instanzen dieser Entität gehören zu EINER Instanz der anderen"
  R.CARD_OPTIONS = [
    { v: '1-1', min: 1, max: '1', label: 'genau eine' },
    { v: '0-1', min: 0, max: '1', label: 'keine oder eine' },
    { v: '1-N', min: 1, max: 'N', label: 'eine oder mehrere' },
    { v: '0-N', min: 0, max: 'N', label: 'beliebig viele' },
  ];
  R.cardKey = (c) => `${c.min}-${c.max}`;
  R.cardFromKey = (k) => {
    const o = R.CARD_OPTIONS.find((x) => x.v === k) || R.CARD_OPTIONS[0];
    return { min: o.min, max: o.max };
  };
  R.cardSymbol = (notation, c) => {
    if (notation === 'minmax') return `(${c.min},${c.max === 'N' ? 'n' : '1'})`;
    if (notation === 'chen') return c.max === 'N' ? 'N' : '1';
    if (c.max === 'N') return c.min === 1 ? '1..*' : '0..*';
    return c.min === 1 ? '1' : '0..1';
  };

  /**
   * Beschriftung an der Kante zur Entität eines Endes.
   * own = Kardinalität dieses Endes, other = des anderen Endes.
   */
  R.endLabel = function (notation, own, other, isFromEnd) {
    switch (notation) {
      case 'chen':
        if (own.max === 'N') return other.max === 'N' ? (isFromEnd ? 'M' : 'N') : 'N';
        return '1';
      case 'uml':
        if (own.max === 'N') return own.min === 1 ? '1..*' : '0..*';
        return own.min === 1 ? '1' : '0..1';
      case 'minmax':
        // Teilnahme: jede Instanz dieser Entität nimmt (other.min .. other.max)-mal teil
        return `(${other.min},${other.max === 'N' ? 'n' : '1'})`;
      default:
        return '';
    }
  };

  R.ratioLabel = (rel) => {
    const a = rel.cardFrom.max === 'N' ? 'N' : '1';
    const b = rel.cardTo.max === 'N' ? 'N' : '1';
    if (a === 'N' && b === 'N') return 'N:M';
    return `${a}:${b}`;
  };

  function attr(name, pk, type) {
    return { id: R.uid(), name, pk: !!pk, type: type || '' };
  }

  /** Beispiel: Kunde 1:N Bestellung N:M Produkt */
  R.sampleDiagram = function (notation, compact) {
    const chen = R.NOTATIONS[notation].family === 'chen';
    const gap = chen ? 470 : 440;
    const y = chen ? 240 : 80;
    const kunde = {
      id: R.uid(),
      name: 'Kunde',
      x: 60,
      y,
      weak: false,
      attributes: compact
        ? [attr('KundenNr', true, 'INT'), attr('Name', false, 'VARCHAR')]
        : [attr('KundenNr', true, 'INT'), attr('Name', false, 'VARCHAR'), attr('E-Mail', false, 'VARCHAR')],
    };
    const bestellung = {
      id: R.uid(),
      name: 'Bestellung',
      x: 60 + gap,
      y,
      weak: false,
      attributes: compact
        ? [attr('BestellNr', true, 'INT'), attr('Datum', false, 'DATE')]
        : [attr('BestellNr', true, 'INT'), attr('Datum', false, 'DATE'), attr('Status', false, 'VARCHAR')],
    };
    const entities = [kunde, bestellung];
    const relationships = [
      {
        id: R.uid(),
        name: 'gibt auf',
        from: kunde.id,
        to: bestellung.id,
        cardFrom: { min: 1, max: '1' },
        cardTo: { min: 0, max: 'N' },
      },
    ];
    if (!compact) {
      const produkt = {
        id: R.uid(),
        name: 'Produkt',
        x: 60 + gap * 2,
        y,
        weak: false,
        attributes: [attr('ArtikelNr', true, 'INT'), attr('Bezeichnung', false, 'VARCHAR'), attr('Preis', false, 'DECIMAL')],
      };
      entities.push(produkt);
      relationships.push({
        id: R.uid(),
        name: 'enthält',
        from: bestellung.id,
        to: produkt.id,
        cardFrom: { min: 0, max: 'N' },
        cardTo: { min: 1, max: 'N' },
      });
    }
    return { entities, relationships };
  };

  R.newProject = function ({ name, description, notation, withSample }) {
    const now = Date.now();
    const base = withSample ? R.sampleDiagram(notation, false) : { entities: [], relationships: [] };
    return {
      id: R.uid(),
      name: name || 'Neues Diagramm',
      description: description || '',
      notation,
      createdAt: now,
      updatedAt: now,
      entities: base.entities,
      relationships: base.relationships,
    };
  };
})();
