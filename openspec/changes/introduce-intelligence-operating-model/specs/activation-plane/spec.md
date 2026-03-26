# activation-plane

The system SHALL treat executive digests, opportunity memos, org playbooks, prototype briefs, video briefs, alerts, and weekly briefs as downstream action assets.

#### Scenario: Prototype brief requires governed upstream object

- **GIVEN** the system wants to generate a prototype brief or video brief
- **WHEN** it evaluates the upstream lineage
- **THEN** the asset must derive from one or more governed `DecisionObject` records
- **AND** it SHALL NOT be generated directly from raw notes or ungoverned findings

The system SHALL distinguish activation assets from intelligence objects.

#### Scenario: Preventing raw-note activation

- **GIVEN** raw evidence or an unreviewed finding exists
- **WHEN** no decision object has been approved or escalated for action
- **THEN** the system does not publish a final action asset from that material
