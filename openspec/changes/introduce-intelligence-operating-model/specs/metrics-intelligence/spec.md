# metrics-intelligence

The system SHALL treat commercial metrics such as `ARR`, `NRR`, and `NDR` as first-class decision inputs.

#### Scenario: Metrics influence decision priority

- **GIVEN** a finding or decision object is materially related to expansion, retention, churn prevention, or commercial leverage
- **WHEN** the system models or reviews it
- **THEN** the object includes metrics context indicating which commercial metric is affected and how strongly

The system SHALL allow metrics absence to be explicitly recorded as an evidence limitation or retrospective lesson.

#### Scenario: Metrics missing during review

- **GIVEN** a meeting cannot confidently resolve a decision object because ARR/NRR/NDR context is missing
- **WHEN** the meeting records follow-up needs
- **THEN** metrics absence may be captured as an evidence request or retrospective factor
