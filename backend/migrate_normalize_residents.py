"""Migration script to normalize the residents table into families.

=============================================================================
IMPORTANT INSTRUCTIONS FOR RUNNING:
1. STOP the backend and frontend servers before running this script.
2. Ensure you have a recent database backup (e.g. pg_dump).
3. RUN 1 (Dry Run):
   Execute with DRY_RUN = True (default) to preview all operations and verify
   that all safety gates pass:
       python migrate_normalize_residents.py
4. RUN 2 (Apply Migration):
   Only after verifying the dry run output with zero errors, change
   `DRY_RUN = False` below and re-run:
       python migrate_normalize_residents.py
5. Restart the backend and frontend services.
=============================================================================
"""

import sys
from sqlalchemy import create_engine, text
from app import app
from models import db

# SAFETY CONTROLLER: Default is True (dry run ROLLBACK).
# Change to False only when ready to apply live COMMIT.
DRY_RUN = True


def run_migration():
    with app.app_context():
        engine = db.engine
        mode_str = "DRY RUN (ROLLBACK)" if DRY_RUN else "LIVE RUN (COMMIT)"
        print(f"Starting migration [{mode_str}]: normalize residents and families tables...")
        with engine.connect() as conn:
            trans = conn.begin()
            try:
                # -------------------------------------------------------------
                # STEP 1: Add missing columns to families table
                # -------------------------------------------------------------
                print("\n[Step 1] Adding missing household columns to families table...")
                conn.execute(text("""
                    ALTER TABLE families
                        ADD COLUMN IF NOT EXISTS address VARCHAR(255),
                        ADD COLUMN IF NOT EXISTS vulnerable_members VARCHAR(255),
                        ADD COLUMN IF NOT EXISTS remarks TEXT,
                        ADD COLUMN IF NOT EXISTS uploaded_by INTEGER;
                """))
                # Add FK for uploaded_by if not present
                conn.execute(text("""
                    DO $$
                    BEGIN
                        IF NOT EXISTS (
                            SELECT 1 FROM pg_constraint WHERE conname = 'families_uploaded_by_fkey'
                        ) THEN
                            ALTER TABLE families
                            ADD CONSTRAINT families_uploaded_by_fkey
                            FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL;
                        END IF;
                    END;
                    $$;
                """))
                print("  -> Columns address, vulnerable_members, remarks, uploaded_by ensured on families.")

                # -------------------------------------------------------------
                # STEP 2: Pre-check: Ensure no orphaned residents exist
                # -------------------------------------------------------------
                print("\n[Step 2] Checking for orphaned residents (family_id IS NULL)...")
                null_family_count = conn.execute(text("SELECT COUNT(*) FROM residents WHERE family_id IS NULL;")).scalar()
                if null_family_count > 0:
                    raise RuntimeError(f"ABORT: Found {null_family_count} residents with family_id IS NULL!")
                print("  -> All residents are linked to a family (0 orphans).")

                # -------------------------------------------------------------
                # STEP 3: Copy values from residents to families where families is empty
                # -------------------------------------------------------------
                print("\n[Step 3] Copying address, vulnerable_members, remarks, uploaded_by to families...")
                update_res = conn.execute(text("""
                    UPDATE families f
                    SET address = COALESCE(f.address, r_sub.address),
                        vulnerable_members = COALESCE(f.vulnerable_members, r_sub.vulnerable_members),
                        remarks = COALESCE(f.remarks, r_sub.remarks),
                        uploaded_by = COALESCE(f.uploaded_by, r_sub.uploaded_by)
                    FROM (
                        SELECT DISTINCT ON (family_id)
                               family_id, address, vulnerable_members, remarks, uploaded_by
                        FROM residents
                        WHERE family_id IS NOT NULL
                    ) r_sub
                    WHERE f.id = r_sub.family_id;
                """))
                print(f"  -> Updated {update_res.rowcount} family records with household data from residents.")

                # -------------------------------------------------------------
                # STEP 4: STRICT SAFETY GATES: Compare EVERY resident against family
                # -------------------------------------------------------------
                print("\n[Step 4] Running strict safety gates across all residents...")
                
                # Check 1: head_name vs household_head_name
                head_diff = conn.execute(text("""
                    SELECT r.id, r.family_id, r.household_head_name, f.head_name
                    FROM residents r
                    JOIN families f ON r.family_id = f.id
                    WHERE r.household_head_name IS DISTINCT FROM f.head_name;
                """)).fetchall()
                if head_diff:
                    raise RuntimeError(f"ABORT: {len(head_diff)} residents differ on head_name! First 5: {head_diff[:5]}")
                print("  -> Gate 1 passed: household_head_name matches family.head_name across 100% of residents.")

                # Check 2: family_members vs member_count
                count_diff = conn.execute(text("""
                    SELECT r.id, r.family_id, r.family_members, f.member_count
                    FROM residents r
                    JOIN families f ON r.family_id = f.id
                    WHERE r.family_members IS DISTINCT FROM f.member_count;
                """)).fetchall()
                if count_diff:
                    raise RuntimeError(f"ABORT: {len(count_diff)} residents differ on member_count! First 5: {count_diff[:5]}")
                print("  -> Gate 2 passed: family_members matches family.member_count across 100% of residents.")

                # Check 3: address
                addr_diff = conn.execute(text("""
                    SELECT r.id, r.family_id, r.address, f.address
                    FROM residents r
                    JOIN families f ON r.family_id = f.id
                    WHERE r.address IS DISTINCT FROM f.address;
                """)).fetchall()
                if addr_diff:
                    raise RuntimeError(f"ABORT: {len(addr_diff)} residents differ on address! First 5: {addr_diff[:5]}")
                print("  -> Gate 3 passed: address matches family.address across 100% of residents.")

                # Check 4: vulnerable_members
                vuln_diff = conn.execute(text("""
                    SELECT r.id, r.family_id, r.vulnerable_members, f.vulnerable_members
                    FROM residents r
                    JOIN families f ON r.family_id = f.id
                    WHERE r.vulnerable_members IS DISTINCT FROM f.vulnerable_members;
                """)).fetchall()
                if vuln_diff:
                    raise RuntimeError(f"ABORT: {len(vuln_diff)} residents differ on vulnerable_members! First 5: {vuln_diff[:5]}")
                print("  -> Gate 4 passed: vulnerable_members matches family.vulnerable_members across 100% of residents.")

                # Check 5: remarks
                rem_diff = conn.execute(text("""
                    SELECT r.id, r.family_id, r.remarks, f.remarks
                    FROM residents r
                    JOIN families f ON r.family_id = f.id
                    WHERE r.remarks IS DISTINCT FROM f.remarks;
                """)).fetchall()
                if rem_diff:
                    raise RuntimeError(f"ABORT: {len(rem_diff)} residents differ on remarks! First 5: {rem_diff[:5]}")
                print("  -> Gate 5 passed: remarks matches family.remarks across 100% of residents.")

                # Check 6: uploaded_by
                up_diff = conn.execute(text("""
                    SELECT r.id, r.family_id, r.uploaded_by, f.uploaded_by
                    FROM residents r
                    JOIN families f ON r.family_id = f.id
                    WHERE r.uploaded_by IS DISTINCT FROM f.uploaded_by;
                """)).fetchall()
                if up_diff:
                    raise RuntimeError(f"ABORT: {len(up_diff)} residents differ on uploaded_by! First 5: {up_diff[:5]}")
                print("  -> Gate 6 passed: uploaded_by matches family.uploaded_by across 100% of residents.")

                # Check 7: contact_number
                contact_diff = conn.execute(text("""
                    SELECT r.id, r.family_id, r.contact_number, f.contact_number
                    FROM residents r
                    JOIN families f ON r.family_id = f.id
                    WHERE r.contact_number IS DISTINCT FROM f.contact_number;
                """)).fetchall()
                if contact_diff:
                    raise RuntimeError(f"ABORT: {len(contact_diff)} residents differ on contact_number! First 5: {contact_diff[:5]}")
                print("  -> Gate 7 passed: contact_number matches family.contact_number across 100% of residents.")

                # Check 8: roster_year_id
                ry_diff = conn.execute(text("""
                    SELECT r.id, r.family_id, r.roster_year_id, f.roster_year_id
                    FROM residents r
                    JOIN families f ON r.family_id = f.id
                    WHERE r.roster_year_id IS DISTINCT FROM f.roster_year_id;
                """)).fetchall()
                if ry_diff:
                    raise RuntimeError(f"ABORT: {len(ry_diff)} residents differ on roster_year_id! First 5: {ry_diff[:5]}")
                print("  -> Gate 8 passed: roster_year_id matches family.roster_year_id across 100% of residents.")

                # Check 9: barangay text vs barangays.name via families.barangay_id
                b_diff = conn.execute(text("""
                    SELECT r.id, r.family_id, r.barangay, b.name as family_barangay
                    FROM residents r
                    JOIN families f ON r.family_id = f.id
                    JOIN barangays b ON f.barangay_id = b.id
                    WHERE LOWER(TRIM(r.barangay)) != LOWER(TRIM(b.name));
                """)).fetchall()
                if b_diff:
                    raise RuntimeError(f"ABORT: {len(b_diff)} residents have barangay text mismatch with families.barangay_id! First 5: {b_diff[:5]}")
                print("  -> Gate 9 passed: residents.barangay text matches barangays.name through families.barangay_id across 100% of residents.")

                # -------------------------------------------------------------
                # STEP 5: Row count verification before dropping
                # -------------------------------------------------------------
                print("\n[Step 5] Checking pre-drop counts...")
                res_count_pre = conn.execute(text("SELECT COUNT(*) FROM residents;")).scalar()
                fam_count_pre = conn.execute(text("SELECT COUNT(*) FROM families;")).scalar()
                print(f"  -> Pre-drop counts: {res_count_pre} residents, {fam_count_pre} families.")

                if res_count_pre != 1055 or fam_count_pre != 347:
                    raise RuntimeError(f"ABORT: Unexpected pre-drop counts! Expected (1055 residents, 347 families), found ({res_count_pre}, {fam_count_pre})")

                # -------------------------------------------------------------
                # STEP 6: Drop redundant FK constraints and columns from residents
                # -------------------------------------------------------------
                print("\n[Step 6] Dropping redundant foreign keys and columns from residents...")
                conn.execute(text("ALTER TABLE residents DROP CONSTRAINT IF EXISTS residents_uploaded_by_fkey;"))
                conn.execute(text("ALTER TABLE residents DROP CONSTRAINT IF EXISTS residents_roster_year_id_fkey;"))
                
                conn.execute(text("""
                    ALTER TABLE residents
                        DROP COLUMN IF EXISTS household_head_name,
                        DROP COLUMN IF EXISTS barangay,
                        DROP COLUMN IF EXISTS address,
                        DROP COLUMN IF EXISTS contact_number,
                        DROP COLUMN IF EXISTS family_members,
                        DROP COLUMN IF EXISTS vulnerable_members,
                        DROP COLUMN IF EXISTS remarks,
                        DROP COLUMN IF EXISTS uploaded_by,
                        DROP COLUMN IF EXISTS roster_year_id;
                """))
                print("  -> Dropped 9 household columns and their FK constraints from residents.")

                # -------------------------------------------------------------
                # STEP 7: Post-drop verification
                # -------------------------------------------------------------
                print("\n[Step 7] Verifying post-drop schema and row counts...")
                res_count_post = conn.execute(text("SELECT COUNT(*) FROM residents;")).scalar()
                fam_count_post = conn.execute(text("SELECT COUNT(*) FROM families;")).scalar()
                print(f"  -> Post-drop counts: {res_count_post} residents, {fam_count_post} families.")

                if res_count_pre != res_count_post or fam_count_pre != fam_count_post:
                    raise RuntimeError(f"ABORT: Row counts changed! Pre: ({res_count_pre}, {fam_count_pre}), Post: ({res_count_post}, {fam_count_post})")

                # Verify columns on residents
                remaining_cols = [r[0] for r in conn.execute(text("""
                    SELECT column_name FROM information_schema.columns
                    WHERE table_name = 'residents' ORDER BY ordinal_position;
                """)).fetchall()]
                print(f"  -> Remaining columns on residents ({len(remaining_cols)}): {remaining_cols}")

                # -------------------------------------------------------------
                # STEP 8: Transaction completion
                # -------------------------------------------------------------
                if DRY_RUN:
                    print("\n" + "=" * 70)
                    print("DRY RUN COMPLETE: All 9 safety gates and verifications PASSED!")
                    print("Rolling back transaction as default safety measure.")
                    print("To permanently apply to the live database:")
                    print("  1. Stop the backend server.")
                    print("  2. Set DRY_RUN = False in migrate_normalize_residents.py.")
                    print("  3. Run: python migrate_normalize_residents.py")
                    print("=" * 70)
                    trans.rollback()
                else:
                    trans.commit()
                    print("\n" + "=" * 70)
                    print("[LIVE COMMIT] Normalization transaction committed successfully.")
                    print("=" * 70)

            except Exception as e:
                trans.rollback()
                print(f"\n[ERROR] Migration failed and was rolled back: {e}")
                sys.exit(1)


if __name__ == "__main__":
    run_migration()
