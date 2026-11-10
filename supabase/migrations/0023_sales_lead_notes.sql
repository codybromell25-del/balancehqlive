-- What the research turned up about a lead that has no field of its own:
-- "contact form only", which site has the staff, who handles wellbeing.
alter table sales_leads add column notes text check (char_length(notes) <= 1000);
