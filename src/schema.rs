//! The evaluated schema: plain data produced by running `zero.config.ts` at
//! build time. Migrations, schema.php, and generated types all derive from it.

use indexmap::IndexMap;
use serde_json::Value as Json;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ColType {
    Integer,
    Real,
    Text,
    Boolean,
    Timestamp,
    Date,
    Json,
}

impl ColType {
    pub fn name(self) -> &'static str {
        match self {
            ColType::Integer => "integer",
            ColType::Real => "real",
            ColType::Text => "text",
            ColType::Boolean => "boolean",
            ColType::Timestamp => "timestamp",
            ColType::Date => "date",
            ColType::Json => "json",
        }
    }

    pub fn sql(self) -> &'static str {
        match self {
            ColType::Integer | ColType::Boolean => "INTEGER",
            ColType::Real => "REAL",
            _ => "TEXT",
        }
    }
}

/// How a column gets a value when the writer leaves it out.
#[derive(Debug, Clone, PartialEq)]
pub enum DefaultKind {
    /// A constant, already in the column's JSON input shape.
    Value(Json),
    /// Current UTC timestamp (or today's date for `date`).
    Now,
    /// A compiled PHP function in functions.php (name without namespace).
    Fn(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RefAction {
    Cascade,
    Restrict,
    SetNull,
    NoAction,
}

impl RefAction {
    pub fn sql(self) -> &'static str {
        match self {
            RefAction::Cascade => "cascade",
            RefAction::Restrict => "restrict",
            RefAction::SetNull => "set null",
            RefAction::NoAction => "no action",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Reference {
    /// Target collection's table name.
    pub collection: String,
    pub column: String,
    pub on_delete: Option<RefAction>,
    pub on_update: Option<RefAction>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Column {
    pub name: String,
    pub ty: ColType,
    pub not_null: bool,
    pub primary_key: bool,
    pub auto_increment: bool,
    pub unique: bool,
    pub enum_values: Option<Vec<String>>,
    pub default: Option<DefaultKind>,
    pub on_update: Option<DefaultKind>,
    pub references: Option<Reference>,
}

impl Column {
    /// Writers may omit it on insert.
    pub fn optional_on_insert(&self) -> bool {
        !self.not_null || self.default.is_some() || self.auto_increment
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RelKind {
    One,
    Many,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Relation {
    pub name: String,
    pub kind: RelKind,
    /// Target table name.
    pub collection: String,
    pub from: String,
    pub to: String,
    pub optional: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum HookKind {
    BeforeCreate,
    AfterCreate,
    BeforeUpdate,
    AfterUpdate,
    BeforeDelete,
    AfterDelete,
}

impl HookKind {
    pub const ALL: [HookKind; 6] = [
        HookKind::BeforeCreate,
        HookKind::AfterCreate,
        HookKind::BeforeUpdate,
        HookKind::AfterUpdate,
        HookKind::BeforeDelete,
        HookKind::AfterDelete,
    ];

    pub fn name(self) -> &'static str {
        match self {
            HookKind::BeforeCreate => "beforeCreate",
            HookKind::AfterCreate => "afterCreate",
            HookKind::BeforeUpdate => "beforeUpdate",
            HookKind::AfterUpdate => "afterUpdate",
            HookKind::BeforeDelete => "beforeDelete",
            HookKind::AfterDelete => "afterDelete",
        }
    }

    pub fn parse(s: &str) -> Option<HookKind> {
        HookKind::ALL.into_iter().find(|h| h.name() == s)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Api {
    pub list: bool,
    pub get: bool,
    pub create: bool,
    pub update: bool,
    pub delete: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Collection {
    /// Key under `schema` in the config (`shoppingList`).
    pub key: String,
    /// Table name and REST path segment (`shopping_list`).
    pub table: String,
    pub columns: IndexMap<String, Column>,
    pub relations: IndexMap<String, Relation>,
    /// Hook → compiled PHP function name.
    pub hooks: IndexMap<HookKind, String>,
    pub api: Api,
}

impl Collection {
    pub fn primary_key(&self) -> Option<&Column> {
        self.columns.values().find(|c| c.primary_key)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Action {
    pub name: String,
    pub input: IndexMap<String, Column>,
    pub handler: String,
}

/// The whole app, keyed by table name.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Schema {
    pub collections: IndexMap<String, Collection>,
    pub actions: IndexMap<String, Action>,
}

impl Schema {
    pub fn by_key(&self, key: &str) -> Option<&Collection> {
        self.collections.values().find(|c| c.key == key)
    }
}
