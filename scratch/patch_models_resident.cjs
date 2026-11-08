const fs = require('fs');
const path = 'backend/models.py';

let code = fs.readFileSync(path, 'utf8');

// 1. Import date from datetime
code = code.replace(
  'from datetime import datetime',
  'from datetime import datetime, date'
);

// 2. Add age property to Resident
const targetProperty = `    @property
    def roster_year_id(self):
        return self.family.roster_year_id if self.family else None`;

const replacementProperty = `    @property
    def roster_year_id(self):
        return self.family.roster_year_id if self.family else None

    @property
    def age(self):
        if not self.date_of_birth:
            return None
        today = date.today()
        born = self.date_of_birth
        try:
            return today.year - born.year - ((today.month, today.day) < (born.month, born.day))
        except Exception:
            return None`;

code = code.replace(targetProperty, replacementProperty);

// 3. Add age to Resident.to_dict()
const targetToDict = `            "date_of_birth": (
                self.date_of_birth.isoformat()
                if self.date_of_birth
                else None
            ),
            "gender": self.gender,`;

const replacementToDict = `            "date_of_birth": (
                self.date_of_birth.isoformat()
                if self.date_of_birth
                else None
            ),
            "age": self.age,
            "gender": self.gender,`;

code = code.replace(targetToDict, replacementToDict);

fs.writeFileSync(path, code, 'utf8');
console.log('SUCCESS: models.py updated with Resident.age.');

